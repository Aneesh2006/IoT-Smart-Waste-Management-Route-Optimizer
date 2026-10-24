import { ArnFormat, CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpUserPoolAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as iot from 'aws-cdk-lib/aws-iot';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { NodejsFunction, type NodejsFunctionProps } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as cr from 'aws-cdk-lib/custom-resources';
import type { Construct } from 'constructs';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SERVICES = `${ROOT}services/src/`;
const WEB_DIST = `${ROOT}apps/web/dist`;

export interface BinSightProps extends StackProps {
  city: string;
  alertEmail?: string;
}

/**
 * Everything BinSight runs on in AWS:
 *
 *   devices ─MQTT─▶ IoT Core ─rule─▶ SQS ─▶ ingest λ ─▶ DynamoDB
 *                                                  └──▶ IoT Core ─MQTT─▶ browsers
 *   EventBridge (1/min) ─▶ fleet λ (virtual bins + trucks) ─HTTPS─▶ IoT Core
 *   browsers ─HTTPS─▶ API Gateway ─▶ api λ (state, metrics, operator control)
 *   CloudFront + S3 host the web app; Cognito signs in guests and operators.
 */
export class BinSightStack extends Stack {
  constructor(scope: Construct, id: string, props: BinSightProps) {
    super(scope, id, props);
    const { city } = props;

    // ---------------------------------------------------------------- data
    const bins = new dynamodb.TableV2(this, 'Bins', {
      partitionKey: { name: 'city', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'bin', type: dynamodb.AttributeType.STRING },
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const readings = new dynamodb.TableV2(this, 'Readings', {
      partitionKey: { name: 'bin', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 't', type: dynamodb.AttributeType.NUMBER },
      timeToLiveAttribute: 'expires',
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const control = new dynamodb.TableV2(this, 'Control', {
      partitionKey: { name: 'city', type: dynamodb.AttributeType.STRING },
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // ---------------------------------------------------------------- queue
    const dlq = new sqs.Queue(this, 'TelemetryDlq', { retentionPeriod: Duration.days(4) });
    const queue = new sqs.Queue(this, 'TelemetryQueue', {
      visibilityTimeout: Duration.seconds(120),
      retentionPeriod: Duration.days(1),
      deadLetterQueue: { queue: dlq, maxReceiveCount: 3 },
    });

    const alerts = new sns.Topic(this, 'Alerts', { displayName: 'BinSight alerts' });
    if (props.alertEmail) alerts.addSubscription(new subs.EmailSubscription(props.alertEmail));

    // ---------------------------------------------------------------- IoT Core
    // The account's MQTT endpoint is only known at deploy time.
    const endpoint = new cr.AwsCustomResource(this, 'IotEndpointLookup', {
      onUpdate: {
        service: 'Iot',
        action: 'describeEndpoint',
        parameters: { endpointType: 'iot:Data-ATS' },
        physicalResourceId: cr.PhysicalResourceId.of('iot-data-ats'),
      },
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({ resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE }),
      installLatestAwsSdk: false,
    });
    const iotEndpoint = endpoint.getResponseField('endpointAddress');

    const ruleErrors = new logs.LogGroup(this, 'RuleErrors', { retention: logs.RetentionDays.ONE_WEEK, removalPolicy: RemovalPolicy.DESTROY });
    const ruleRole = new iam.Role(this, 'TelemetryRuleRole', { assumedBy: new iam.ServicePrincipal('iot.amazonaws.com') });
    queue.grantSendMessages(ruleRole);
    ruleErrors.grantWrite(ruleRole);
    const rule = new iot.CfnTopicRule(this, 'TelemetryRule', {
      topicRulePayload: {
        description: 'Every bin reading in the city goes to the ingest queue, stamped with the time IoT Core saw it.',
        sql: "SELECT *, topic(2) AS city, topic(4) AS binId, timestamp() AS tRule FROM 'binsight/+/bins/+/telemetry'",
        awsIotSqlVersion: '2016-03-23',
        ruleDisabled: false,
        actions: [{ sqs: { queueUrl: queue.queueUrl, roleArn: ruleRole.roleArn, useBase64: false } }],
        errorAction: { cloudwatchLogs: { logGroupName: ruleErrors.logGroupName, roleArn: ruleRole.roleArn } },
      },
    });

    // ---------------------------------------------------------------- functions
    const env = {
      CITY: city,
      BINS_TABLE: bins.tableName,
      READINGS_TABLE: readings.tableName,
      CONTROL_TABLE: control.tableName,
      IOT_ENDPOINT: iotEndpoint,
      ALERT_TOPIC_ARN: alerts.topicArn,
      NODE_OPTIONS: '--enable-source-maps',
    };
    const fn = (name: string, file: string, extra: Partial<NodejsFunctionProps>) =>
      new NodejsFunction(this, name, {
        entry: `${SERVICES}${file}`,
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_22_X,
        architecture: lambda.Architecture.ARM_64,
        projectRoot: ROOT,
        depsLockFilePath: `${ROOT}pnpm-lock.yaml`,
        environment: env,
        bundling: { target: 'node22', minify: true, sourceMap: true, externalModules: ['@aws-sdk/*'] },
        logGroup: new logs.LogGroup(this, `${name}Logs`, { retention: logs.RetentionDays.ONE_WEEK, removalPolicy: RemovalPolicy.DESTROY }),
        ...extra,
      });

    const iotPublish = new iam.PolicyStatement({
      actions: ['iot:Publish', 'iot:RetainPublish'],
      resources: [this.formatArn({ service: 'iot', resource: 'topic', resourceName: 'binsight/*' })],
    });

    const ingest = fn('Ingest', 'ingest.ts', { timeout: Duration.seconds(20), memorySize: 512 });
    const ingestSource = new SqsEventSource(queue, { batchSize: 10, maxConcurrency: 2 });
    ingest.addEventSource(ingestSource);
    bins.grantReadWriteData(ingest);
    readings.grantWriteData(ingest);
    control.grantReadData(ingest);
    alerts.grantPublish(ingest);
    ingest.addToRolePolicy(iotPublish);

    const fleet = fn('Fleet', 'fleet.ts', { timeout: Duration.seconds(60), memorySize: 1769 });
    control.grantReadWriteData(fleet);
    fleet.addToRolePolicy(iotPublish);
    new events.Rule(this, 'FleetEveryMinute', {
      description: 'Wake the virtual fleet once a minute; each run lasts about a minute.',
      schedule: events.Schedule.rate(Duration.minutes(1)),
      targets: [new targets.LambdaFunction(fleet, { retryAttempts: 0, maxEventAge: Duration.minutes(1) })],
    });

    const api = fn('Api', 'api.ts', {
      timeout: Duration.seconds(10),
      memorySize: 256,
      environment: {
        ...env,
        QUEUE_URL: queue.queueUrl,
        QUEUE_NAME: queue.queueName,
        DLQ_URL: dlq.queueUrl,
        RULE_NAME: rule.ref,
        INGEST_FUNCTION: ingest.functionName,
        FLEET_FUNCTION: fleet.functionName,
        INGEST_MAPPING_ID: ingestSource.eventSourceMappingId,
      },
    });
    bins.grantReadData(api);
    control.grantReadWriteData(api);
    fleet.grantInvoke(api);
    api.addToRolePolicy(new iam.PolicyStatement({ actions: ['cloudwatch:GetMetricData'], resources: ['*'] }));
    api.addToRolePolicy(new iam.PolicyStatement({ actions: ['sqs:GetQueueAttributes'], resources: [queue.queueArn, dlq.queueArn] }));
    api.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['lambda:UpdateEventSourceMapping'],
        resources: [this.formatArn({ service: 'lambda', resource: 'event-source-mapping', resourceName: ingestSource.eventSourceMappingId, arnFormat: ArnFormat.COLON_RESOURCE_NAME })],
      }),
    );

    // ---------------------------------------------------------------- identity
    // Operators sign in to a user pool; the API only accepts control calls with its token.
    const operators = new cognito.UserPool(this, 'Operators', {
      selfSignUpEnabled: false,
      signInAliases: { username: true },
      passwordPolicy: { minLength: 8, requireSymbols: false },
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const operatorClient = operators.addClient('WebClient', { authFlows: { userPassword: true }, generateSecret: false });

    // Everyone else (dashboards, phones) is a guest identity with MQTT rights only.
    // Basic (classic) flow: the enhanced flow's guest session policy does not allow IoT.
    const guests = new cognito.CfnIdentityPool(this, 'Guests', { allowUnauthenticatedIdentities: true, allowClassicFlow: true });
    const sub = '${cognito-identity.amazonaws.com:sub}';
    const guestRole = new iam.Role(this, 'GuestRole', {
      description: 'MQTT for browsers and phones: read the city, publish only as your own bin.',
      assumedBy: new iam.FederatedPrincipal(
        'cognito-identity.amazonaws.com',
        {
          StringEquals: { 'cognito-identity.amazonaws.com:aud': guests.ref },
          'ForAnyValue:StringLike': { 'cognito-identity.amazonaws.com:amr': 'unauthenticated' },
        },
        'sts:AssumeRoleWithWebIdentity',
      ),
      maxSessionDuration: Duration.hours(1),
    });
    const iotArn = (resource: string, name: string) => this.formatArn({ service: 'iot', resource, resourceName: name });
    guestRole.addToPolicy(new iam.PolicyStatement({ actions: ['iot:Connect'], resources: [iotArn('client', `${sub}-*`)] }));
    guestRole.addToPolicy(new iam.PolicyStatement({ actions: ['iot:Subscribe'], resources: [iotArn('topicfilter', 'binsight/*')] }));
    guestRole.addToPolicy(new iam.PolicyStatement({ actions: ['iot:Receive'], resources: [iotArn('topic', 'binsight/*')] }));
    guestRole.addToPolicy(new iam.PolicyStatement({ actions: ['iot:Publish'], resources: [iotArn('topic', `binsight/*/bins/p-${sub}/telemetry`)] }));
    new cognito.CfnIdentityPoolRoleAttachment(this, 'GuestRoles', { identityPoolId: guests.ref, roles: { unauthenticated: guestRole.roleArn } });

    // ---------------------------------------------------------------- HTTP API
    const http = new apigw.HttpApi(this, 'Http', {
      description: 'BinSight state, metrics and operator control',
      corsPreflight: {
        allowOrigins: ['*'],
        allowMethods: [apigw.CorsHttpMethod.GET, apigw.CorsHttpMethod.POST],
        allowHeaders: ['authorization', 'content-type'],
        maxAge: Duration.hours(1),
      },
    });
    const integration = new HttpLambdaIntegration('ApiIntegration', api);
    for (const path of ['/time', '/config', '/state', '/metrics']) http.addRoutes({ path, methods: [apigw.HttpMethod.GET], integration });
    http.addRoutes({
      path: '/control',
      methods: [apigw.HttpMethod.POST],
      integration,
      authorizer: new HttpUserPoolAuthorizer('OperatorAuth', operators, { userPoolClients: [operatorClient] }),
    });
    // Keep a runaway client from burning the free tier.
    const stage = http.defaultStage!.node.defaultChild as apigw.CfnStage;
    stage.defaultRouteSettings = { throttlingBurstLimit: 50, throttlingRateLimit: 25 };

    // ---------------------------------------------------------------- hosting
    const site = new s3.Bucket(this, 'Site', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });
    const cdn = new cloudfront.Distribution(this, 'Cdn', {
      comment: 'BinSight web app',
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(site),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      defaultRootObject: 'index.html',
      // Client-side routes (/bin) fall back to the app.
      errorResponses: [403, 404].map((httpStatus) => ({ httpStatus, responseHttpStatus: 200, responsePagePath: '/index.html', ttl: Duration.seconds(0) })),
      priceClass: cloudfront.PriceClass.PRICE_CLASS_200,
    });

    const liveConfig = {
      region: this.region,
      city,
      identityPoolId: guests.ref,
      guestRoleArn: guestRole.roleArn,
      iotEndpoint,
      apiUrl: http.apiEndpoint,
      userPoolClientId: operatorClient.userPoolClientId,
    };
    if (existsSync(WEB_DIST)) {
      new s3deploy.BucketDeployment(this, 'DeploySite', {
        destinationBucket: site,
        sources: [s3deploy.Source.asset(WEB_DIST), s3deploy.Source.jsonData('live-config.json', liveConfig)],
        distribution: cdn,
        distributionPaths: ['/*'],
        memoryLimit: 512,
      });
    }

    // ---------------------------------------------------------------- guard rails
    new budgets.CfnBudget(this, 'Budget', {
      budget: { budgetName: 'binsight-monthly', budgetType: 'COST', timeUnit: 'MONTHLY', budgetLimit: { amount: 5, unit: 'USD' } },
      notificationsWithSubscribers: props.alertEmail
        ? [
            {
              notification: { notificationType: 'ACTUAL', comparisonOperator: 'GREATER_THAN', threshold: 80, thresholdType: 'PERCENTAGE' },
              subscribers: [{ subscriptionType: 'EMAIL', address: props.alertEmail }],
            },
          ]
        : [],
    });

    // ---------------------------------------------------------------- outputs (read by scripts/write-live-config.mjs)
    new CfnOutput(this, 'SiteUrl', { value: `https://${cdn.distributionDomainName}` });
    new CfnOutput(this, 'Region', { value: this.region });
    new CfnOutput(this, 'City', { value: city });
    new CfnOutput(this, 'IdentityPoolId', { value: guests.ref });
    new CfnOutput(this, 'GuestRoleArn', { value: guestRole.roleArn });
    new CfnOutput(this, 'IotEndpoint', { value: iotEndpoint });
    new CfnOutput(this, 'ApiUrl', { value: http.apiEndpoint });
    new CfnOutput(this, 'UserPoolId', { value: operators.userPoolId });
    new CfnOutput(this, 'UserPoolClientId', { value: operatorClient.userPoolClientId });
    new CfnOutput(this, 'AlertTopicArn', { value: alerts.topicArn });
  }
}
