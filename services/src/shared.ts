import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { IoTDataPlaneClient, PublishCommand } from '@aws-sdk/client-iot-data-plane';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { defaultControl, type LiveControl } from '@binsight/core';

/** Environment the CDK stack gives every function. Read lazily so tests can import freely. */
export const env = {
  get city() {
    return process.env.CITY ?? 'demo';
  },
  get binsTable() {
    return required('BINS_TABLE');
  },
  get readingsTable() {
    return required('READINGS_TABLE');
  },
  get controlTable() {
    return required('CONTROL_TABLE');
  },
  get iotEndpoint() {
    return required('IOT_ENDPOINT');
  },
  get alertTopicArn() {
    return process.env.ALERT_TOPIC_ARN ?? '';
  },
};

function required(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

let ddbClient: DynamoDBDocumentClient | undefined;
export function ddb() {
  ddbClient ??= DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
  return ddbClient;
}

let iotClient: IoTDataPlaneClient | undefined;
export function iot() {
  iotClient ??= new IoTDataPlaneClient({ endpoint: `https://${env.iotEndpoint}` });
  return iotClient;
}

const encoder = new TextEncoder();

export async function publish(topic: string, payload: unknown, retain = false) {
  await iot().send(new PublishCommand({ topic, qos: 0, retain, payload: encoder.encode(JSON.stringify(payload)) }));
}

/** Run async jobs with at most `limit` in flight. */
export async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<unknown>) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  });
  await Promise.all(workers);
}

export async function loadControl(city = env.city): Promise<LiveControl> {
  const res = await ddb().send(new GetCommand({ TableName: env.controlTable, Key: { city } }));
  if (res.Item) return { ...defaultControl(city), ...(res.Item as LiveControl) };
  const fresh = defaultControl(city);
  await saveControl(fresh);
  return fresh;
}

export async function saveControl(control: LiveControl) {
  await ddb().send(new PutCommand({ TableName: env.controlTable, Item: control }));
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
