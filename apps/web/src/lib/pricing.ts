/**
 * Approximate AWS list prices (USD) used for the cost meter. They are teaching
 * numbers: close to published on-demand rates, but check aws.amazon.com/pricing
 * for your region before quoting them.
 */
export const PRICES = {
  iotMessagePerMillion: 1.0,
  iotRuleTriggerPerMillion: 0.15,
  iotRuleActionPerMillion: 0.15,
  sqsRequestPerMillion: 0.4,
  lambdaRequestPerMillion: 0.2,
  lambdaArmGbSecond: 0.0000133334,
  dynamoWritePerMillion: 0.625,
  usdToInr: 84,
};

export interface CostBreakdown {
  iot: number;
  rules: number;
  sqs: number;
  lambda: number;
  dynamo: number;
  total: number;
}

/**
 * Cost of `readings` sensor readings flowing through the pipeline, with
 * `dashboards` browsers watching (IoT bills each delivered copy).
 */
export function pipelineCost(readings: number, dashboards = 3, batch = 10): CostBreakdown {
  const m = readings / 1e6;
  const iot = m * PRICES.iotMessagePerMillion * (1 + dashboards / batch);
  const rules = m * (PRICES.iotRuleTriggerPerMillion + PRICES.iotRuleActionPerMillion);
  // Send per reading; receive and delete happen once per batch.
  const sqs = m * PRICES.sqsRequestPerMillion * (1 + 2 / batch);
  const invocations = readings / batch;
  const lambda = (invocations / 1e6) * PRICES.lambdaRequestPerMillion + invocations * 0.25 * 0.5 * PRICES.lambdaArmGbSecond;
  // Latest state plus a history row per reading.
  const dynamo = m * 2 * PRICES.dynamoWritePerMillion;
  return { iot, rules, sqs, lambda, dynamo, total: iot + rules + sqs + lambda + dynamo };
}
