import { App } from 'aws-cdk-lib';
import { BinSightStack } from '../lib/stack.ts';

const app = new App();
new BinSightStack(app, 'BinSight', {
  // Mumbai, whatever the CLI's default region happens to be.
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.BINSIGHT_REGION ?? 'ap-south-1' },
  city: app.node.tryGetContext('city') ?? 'demo',
  // Optional: `cdk deploy -c alertEmail=you@example.com` subscribes that inbox to fire alerts and the budget alarm.
  alertEmail: app.node.tryGetContext('alertEmail'),
  description: 'BinSight: IoT smart waste management and route optimizer (BCS VII cloud project)',
});
