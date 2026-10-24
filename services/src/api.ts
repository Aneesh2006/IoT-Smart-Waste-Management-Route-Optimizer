import { CloudWatchClient, GetMetricDataCommand, type MetricDataQuery } from '@aws-sdk/client-cloudwatch';
import { InvokeCommand, LambdaClient, UpdateEventSourceMappingCommand } from '@aws-sdk/client-lambda';
import { GetQueueAttributesCommand, SQSClient } from '@aws-sdk/client-sqs';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import {
  CHAOS_ORDER,
  LIVE_SIM_QUANTUM,
  LIVE_START_SIM_T,
  POLICY_ORDER,
  simTimeAt,
  worldKey,
  type ChaosKind,
  type LiveControl,
  type PolicyId,
} from '@binsight/core';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { ddb, env, loadControl, saveControl } from './shared.ts';

/**
 * The HTTP API: public reads (config, state, time, metrics) and the operator's
 * control endpoint, which API Gateway only lets through with a Cognito token.
 */
const json = (status: number, body: unknown): APIGatewayProxyResultV2 => ({
  statusCode: status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  body: JSON.stringify(body),
});

let lambda: LambdaClient | undefined;
let sqs: SQSClient | undefined;
let cw: CloudWatchClient | undefined;

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const route = `${event.requestContext.http.method} ${event.rawPath.replace(/\/+$/, '') || '/'}`;
  try {
    switch (route) {
      case 'GET /time':
        return json(200, { now: Date.now() });
      case 'GET /config':
        return json(200, await loadControl());
      case 'GET /state':
        return json(200, await state());
      case 'GET /metrics':
        return json(200, await metrics());
      case 'POST /control':
        return await control(event.body ? JSON.parse(event.body) : {});
      default:
        return json(404, { error: `No route ${route}` });
    }
  } catch (e) {
    console.error(e);
    return json(500, { error: (e as Error).message });
  }
};

async function state() {
  const c = await loadControl();
  const world = worldKey(c);
  const items: Record<string, unknown>[] = [];
  let start: Record<string, unknown> | undefined;
  do {
    const page = await ddb().send(
      new QueryCommand({ TableName: env.binsTable, KeyConditionExpression: 'city = :c', ExpressionAttributeValues: { ':c': c.city }, ExclusiveStartKey: start }),
    );
    items.push(...((page.Items as Record<string, unknown>[]) ?? []));
    start = page.LastEvaluatedKey;
  } while (start);
  const now = Date.now();
  const bins = items.filter((it) => (it.kind === 'phone' ? now - Number(it.lastSeen) < 2 * 3600_000 : it.world === world));
  return { control: c, bins };
}

type ControlBody =
  | { action: 'start' }
  | { action: 'stop' }
  | { action: 'speed'; speed: number }
  | { action: 'policy'; policy: PolicyId }
  | { action: 'chaos'; kind: ChaosKind }
  | { action: 'reset'; seed?: string; bins?: number; trucks?: number; policy?: PolicyId }
  | { action: 'ingest'; paused: boolean };

async function control(body: ControlBody) {
  const c = await loadControl();
  const now = Date.now();
  const reanchor = () => {
    c.anchorSimT = simTimeAt(c, now);
    c.anchorWall = now;
  };
  // Changes land a couple of ticks in the future so every replay applies them at the same sim time.
  const soon = () => simTimeAt(c, now) + 2 * LIVE_SIM_QUANTUM;
  let kick = false;

  switch (body.action) {
    case 'start':
      if (!c.running) {
        c.anchorWall = now;
        c.running = true;
        kick = true;
      }
      break;
    case 'stop':
      reanchor();
      c.running = false;
      break;
    case 'speed':
      reanchor();
      c.speed = clampInt(body.speed, 5, 600);
      break;
    case 'policy':
      if (!POLICY_ORDER.includes(body.policy)) return json(400, { error: 'Unknown policy' });
      c.policyChanges = [...c.policyChanges, { at: soon(), policy: body.policy }];
      c.policy = body.policy;
      break;
    case 'chaos':
      if (!CHAOS_ORDER.includes(body.kind)) return json(400, { error: 'Unknown chaos kind' });
      c.events = [...c.events, { at: soon(), kind: body.kind }];
      break;
    case 'reset': {
      const policy = body.policy && POLICY_ORDER.includes(body.policy) ? body.policy : c.policy;
      c.seed = typeof body.seed === 'string' && body.seed.trim() ? body.seed.trim().replace(/[^\w-]/g, '').slice(0, 40) || c.seed : c.seed;
      c.bins = body.bins ? clampInt(body.bins, 20, 1000) : c.bins;
      c.trucks = body.trucks ? clampInt(body.trucks, 1, 8) : c.trucks;
      c.policy = policy;
      c.startPolicy = policy;
      c.policyChanges = [];
      c.events = [];
      c.anchorSimT = LIVE_START_SIM_T;
      c.anchorWall = now;
      c.epoch += 1;
      c.running = true;
      kick = true;
      break;
    }
    case 'ingest':
      lambda ??= new LambdaClient({});
      await lambda.send(new UpdateEventSourceMappingCommand({ UUID: process.env.INGEST_MAPPING_ID, Enabled: !body.paused }));
      c.ingestPaused = body.paused;
      break;
    default:
      return json(400, { error: 'Unknown action' });
  }
  await saveControl(c);
  // Don't make the room wait up to a minute for the scheduled run.
  if (kick && process.env.FLEET_FUNCTION) {
    lambda ??= new LambdaClient({});
    await lambda.send(new InvokeCommand({ FunctionName: process.env.FLEET_FUNCTION, InvocationType: 'Event' }));
  }
  return json(200, c satisfies LiveControl);
}

const clampInt = (v: unknown, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(Number(v) || lo)));

/** CloudWatch series for the Cloud X-Ray, plus the live queue depth straight from SQS. */
async function metrics() {
  const fn = (name: string | undefined) => (name ? [{ Name: 'FunctionName', Value: name }] : []);
  const q = (id: string, ns: string, metric: string, stat: string, dims: { Name: string; Value: string }[]): MetricDataQuery => ({
    Id: id,
    MetricStat: { Metric: { Namespace: ns, MetricName: metric, Dimensions: dims }, Period: 60, Stat: stat },
    ReturnData: true,
  });
  const queue = [{ Name: 'QueueName', Value: process.env.QUEUE_NAME ?? '' }];
  const queries: MetricDataQuery[] = [
    q('ruleMatches', 'AWS/IoT', 'TopicMatch', 'Sum', [{ Name: 'RuleName', Value: process.env.RULE_NAME ?? '' }]),
    q('iotInMqtt', 'AWS/IoT', 'PublishIn.Success', 'Sum', [{ Name: 'Protocol', Value: 'MQTT' }]),
    q('iotInHttp', 'AWS/IoT', 'PublishIn.Success', 'Sum', [{ Name: 'Protocol', Value: 'HTTP' }]),
    q('sqsSent', 'AWS/SQS', 'NumberOfMessagesSent', 'Sum', queue),
    q('sqsDepth', 'AWS/SQS', 'ApproximateNumberOfMessagesVisible', 'Maximum', queue),
    q('sqsAge', 'AWS/SQS', 'ApproximateAgeOfOldestMessage', 'Maximum', queue),
    q('ingestInv', 'AWS/Lambda', 'Invocations', 'Sum', fn(process.env.INGEST_FUNCTION)),
    q('ingestDur', 'AWS/Lambda', 'Duration', 'Average', fn(process.env.INGEST_FUNCTION)),
    q('ingestErr', 'AWS/Lambda', 'Errors', 'Sum', fn(process.env.INGEST_FUNCTION)),
    q('ingestThr', 'AWS/Lambda', 'Throttles', 'Sum', fn(process.env.INGEST_FUNCTION)),
    q('ingestConc', 'AWS/Lambda', 'ConcurrentExecutions', 'Maximum', fn(process.env.INGEST_FUNCTION)),
    q('fleetInv', 'AWS/Lambda', 'Invocations', 'Sum', fn(process.env.FLEET_FUNCTION)),
    q('apiInv', 'AWS/Lambda', 'Invocations', 'Sum', fn(process.env.AWS_LAMBDA_FUNCTION_NAME)),
    q('binsWcu', 'AWS/DynamoDB', 'ConsumedWriteCapacityUnits', 'Sum', [{ Name: 'TableName', Value: env.binsTable }]),
    q('readingsWcu', 'AWS/DynamoDB', 'ConsumedWriteCapacityUnits', 'Sum', [{ Name: 'TableName', Value: env.readingsTable }]),
  ];
  cw ??= new CloudWatchClient({});
  sqs ??= new SQSClient({});
  const end = new Date();
  const start = new Date(end.getTime() - 20 * 60_000);
  const [data, live, dlq] = await Promise.all([
    cw.send(new GetMetricDataCommand({ MetricDataQueries: queries, StartTime: start, EndTime: end, ScanBy: 'TimestampAscending' })),
    sqs.send(new GetQueueAttributesCommand({ QueueUrl: process.env.QUEUE_URL, AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible'] })),
    process.env.DLQ_URL
      ? sqs.send(new GetQueueAttributesCommand({ QueueUrl: process.env.DLQ_URL, AttributeNames: ['ApproximateNumberOfMessages'] }))
      : Promise.resolve(undefined),
  ]);
  const series: Record<string, { t: number[]; v: number[] }> = {};
  for (const r of data.MetricDataResults ?? []) {
    series[r.Id!] = { t: (r.Timestamps ?? []).map((d) => d.getTime()), v: r.Values ?? [] };
  }
  return {
    now: end.getTime(),
    series,
    queue: {
      visible: Number(live.Attributes?.ApproximateNumberOfMessages ?? 0),
      inFlight: Number(live.Attributes?.ApproximateNumberOfMessagesNotVisible ?? 0),
      dlq: Number(dlq?.Attributes?.ApproximateNumberOfMessages ?? 0),
    },
  };
}
