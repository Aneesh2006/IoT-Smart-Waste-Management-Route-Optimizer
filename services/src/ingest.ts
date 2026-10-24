import { PublishCommand as SnsPublish, SNSClient } from '@aws-sdk/client-sns';
import { BatchWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { topics, type Alert, type PhoneCommand, type StateUpdate } from '@binsight/core';
import type { SQSHandler } from 'aws-lambda';
import {
  DISPATCH_STALE_MS,
  PHONE_DISPATCH_AT,
  latestPerBin,
  oldestHops,
  parseMessage,
  truckFor,
  withStatus,
  type Incoming,
} from './ingest-logic.ts';
import { ddb, env, pool, publish } from './shared.ts';

/**
 * SQS → this function → DynamoDB → MQTT. Every sensor reading in the city passes
 * through here: store the latest state and a history row, raise alerts, dispatch
 * trucks to phone bins, and broadcast the batch to every browser.
 */
const READING_TTL_S = 3 * 24 * 3600;
let sns: SNSClient | undefined;

export const handler: SQSHandler = async (event) => {
  const tLambda = Date.now();
  const incoming: Incoming[] = [];
  for (const rec of event.Records) {
    const msg = parseMessage(rec.body);
    if (msg) incoming.push({ msg, tQueue: Number(rec.attributes.SentTimestamp) || tLambda });
  }
  if (!incoming.length) return;

  const latest = latestPerBin(incoming);
  const byCity = new Map<string, Incoming[]>();
  for (const it of latest) byCity.set(it.msg.city, [...(byCity.get(it.msg.city) ?? []), it]);

  for (const [city, items] of byCity) {
    const fleet = items.filter((i) => i.msg.kind === 'fleet');
    const phones = items.filter((i) => i.msg.kind === 'phone');
    const expires = Math.floor(tLambda / 1000) + READING_TTL_S;

    // Latest state + history rows, 25 items per batch write.
    const writes = [
      ...fleet.map((i) => ({ table: env.binsTable, item: binItem(i, tLambda) })),
      ...incoming
        .filter((i) => i.msg.city === city)
        .map((i) => ({ table: env.readingsTable, item: { bin: `${city}#${i.msg.id}`, t: i.msg.tDevice, r: i.msg.r, temp: i.msg.temp, gas: i.msg.gas, expires } })),
    ];
    const chunks: (typeof writes)[] = [];
    for (let k = 0; k < writes.length; k += 25) chunks.push(writes.slice(k, k + 25));
    await pool(chunks, 4, (chunk) => {
      const RequestItems: Record<string, { PutRequest: { Item: Record<string, unknown> } }[]> = {};
      for (const w of chunk) (RequestItems[w.table] ??= []).push({ PutRequest: { Item: w.item } });
      return ddb().send(new BatchWriteCommand({ RequestItems }));
    });

    // Phones are few: update them one by one so we can see what changed.
    const alerts: Alert[] = [];
    await pool(phones, 4, async (i) => alerts.push(...(await handlePhone(city, i, tLambda))));
    const tStored = Date.now();

    for (const i of items) {
      if (i.msg.ok && i.msg.temp > 60) {
        const fresh = await claimAlert(city, i.msg.id, 'fireAlertAt', 30 * 60_000, tLambda);
        if (fresh) alerts.push({ kind: 'fire', binId: i.msg.id, text: `Fire in bin ${label(i)}: ${Math.round(i.msg.temp)} °C`, wallT: tLambda });
      }
    }

    const update: StateUpdate = {
      bins: items.map((i) => withStatus(i.msg)),
      hops: oldestHops(items, tLambda, tStored, Date.now()),
      batch: event.Records.length,
    };
    await publish(topics.state(city), update);
    for (const a of alerts) await publish(topics.alerts(city), a);
    await notify(alerts.filter((a) => a.kind === 'fire'));
  }
};

function binItem(i: Incoming, now: number) {
  const m = withStatus(i.msg);
  return { city: i.msg.city, bin: i.msg.id, ...m, lastSeen: now, tQueue: i.tQueue };
}

const label = (i: Incoming) => (i.msg.kind === 'phone' ? `${i.msg.emoji ?? ''} ${i.msg.nick ?? 'phone'}`.trim() : `#${i.msg.id}`);

async function handlePhone(city: string, i: Incoming, now: number): Promise<Alert[]> {
  const res = await ddb().send(
    new UpdateCommand({
      TableName: env.binsTable,
      Key: { city, bin: i.msg.id },
      UpdateExpression:
        'SET kind = :k, r = :r, ok = :ok, temp = :temp, gas = :gas, bat = :bat, tDevice = :td, lastSeen = :now, nick = :nick, emoji = :emoji, #st = :st, score = :score',
      ExpressionAttributeNames: { '#st': 'status' },
      ExpressionAttributeValues: {
        ':k': 'phone',
        ':r': i.msg.r,
        ':ok': i.msg.ok,
        ':temp': i.msg.temp,
        ':gas': i.msg.gas,
        ':bat': i.msg.bat,
        ':td': i.msg.tDevice,
        ':now': now,
        ':nick': i.msg.nick ?? 'Guest',
        ':emoji': i.msg.emoji ?? '🗑️',
        ':st': withStatus(i.msg).status,
        ':score': i.msg.score ?? 0,
      },
      ReturnValues: 'ALL_OLD',
    }),
  );
  const old = res.Attributes as { dispatchAt?: number } | undefined;
  const alerts: Alert[] = [];
  const who = label(i);
  if (!old) alerts.push({ kind: 'joined', binId: i.msg.id, text: `${who} joined the city as a smart bin`, wallT: now });

  if (i.msg.event === 'collected') {
    await ddb().send(new UpdateCommand({ TableName: env.binsTable, Key: { city, bin: i.msg.id }, UpdateExpression: 'REMOVE dispatchAt' }));
    alerts.push({ kind: 'collected', binId: i.msg.id, text: `${who}'s bin emptied`, wallT: now });
  } else if (i.msg.r >= PHONE_DISPATCH_AT && (!old?.dispatchAt || now - old.dispatchAt > DISPATCH_STALE_MS)) {
    const claimed = await claimAlert(city, i.msg.id, 'dispatchAt', DISPATCH_STALE_MS, now);
    if (claimed) {
      const truck = truckFor(i.msg.id);
      const cmd: PhoneCommand = { type: 'dispatch', truck, eta: 20, text: `${truck} is on its way` };
      await publish(topics.phoneCmd(city, i.msg.id), cmd);
      alerts.push({ kind: 'dispatch', binId: i.msg.id, text: `${truck} dispatched to ${who} (${Math.round(i.msg.r * 100)}% full)`, wallT: now });
    }
  }
  return alerts;
}

/** Set `field` = now unless it was set within `windowMs`; true if we won. Dedupes alerts across retries. */
async function claimAlert(city: string, bin: string, field: string, windowMs: number, now: number) {
  try {
    await ddb().send(
      new UpdateCommand({
        TableName: env.binsTable,
        Key: { city, bin },
        UpdateExpression: 'SET #f = :now',
        ConditionExpression: 'attribute_not_exists(#f) OR #f < :stale',
        ExpressionAttributeNames: { '#f': field },
        ExpressionAttributeValues: { ':now': now, ':stale': now - windowMs },
      }),
    );
    return true;
  } catch (e) {
    if ((e as Error).name === 'ConditionalCheckFailedException') return false;
    throw e;
  }
}

async function notify(alerts: Alert[]) {
  if (!alerts.length || !env.alertTopicArn) return;
  sns ??= new SNSClient({});
  for (const a of alerts) {
    await sns.send(new SnsPublish({ TopicArn: env.alertTopicArn, Subject: `BinSight alert: ${a.kind}`, Message: `${a.text}\n\n${new Date(a.wallT).toISOString()}` }));
  }
}
