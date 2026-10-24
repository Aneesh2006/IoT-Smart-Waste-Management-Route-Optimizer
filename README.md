# BinSight: IoT Smart Waste Management & Route Optimizer

A cloud digital twin of a city's waste network: smart bins report their fill
level, a forecaster learns each bin's daily rhythm, and a route optimizer sends
trucks only where they are needed. Built for the BCS VII-semester Cloud Computing
group project.

## Layout

```
apps/web        3D mission-control UI (Vite, React, react-three-fiber) and the /bin phone page
packages/core   deterministic simulation: city generator, bins, trucks,
                Dijkstra/A*, CVRP solvers, policies, metrics, live-mode contract
services        Lambda functions: ingest (SQS → DynamoDB → MQTT), fleet (virtual
                bins and trucks), api (state, metrics, operator control)
infra           AWS CDK stack: IoT Core rule, SQS + DLQ, Lambda, DynamoDB,
                API Gateway, Cognito, S3 + CloudFront, SNS, budget alarm
```

## Run it

```bash
pnpm install
pnpm dev        # http://localhost:5173
pnpm test       # core unit tests
pnpm sim        # one seeded week under every policy, as a table
```

Add `?seed=anything` to the URL to build a different (but reproducible) city. The
link button in the top bar copies a URL carrying the seed, policy, solver, fleet
size and speed.

## What's in it

- **Mission control**: a procedural 3D city with day/night, smart bins as glowing
  pillars, trucks driving their planned routes, and a data view (`V`).
- **Policies**: Fixed schedule, Threshold, Predictive (learns each bin's daily
  rhythm) and Dynamic (hourly re-plans).
- **Compare** (`C`): every policy over the same seeded week, optionally with a
  disruption on Wednesday.
- **Algorithm lab** (`L`): nearest neighbour, Clarke–Wright, 2-opt, Or-opt,
  simulated annealing and ant colony, scored against the exact Held–Karp optimum;
  plus Dijkstra's wavefront vs A*.
- **Chaos lab**: festival spike (with fireworks), monsoon flooding (with rain),
  truck breakdown, dead sensors, bin fire.
- **Cloud X-Ray** (`X`): readings flying through the AWS pipeline, timed hop by
  hop, with CloudWatch counters in Live mode and a cost meter for any city size.
- **Heatmap** (`G`), **time-lapse replay** (`R`), **minimap**, and a **command
  palette** (`/` or Ctrl+K) to find any bin or truck.
- **Impact** (`I`): waste-flow Sankey, a Gantt of the fleet's day, and a
  capacity planner that tests bigger bins on a seeded week.
- **Bin inspector** tabs for the sensor hardware and the MQTT message on the wire.
- **Presentation mode** (`P`), optional sound cues, automatic performance mode,
  and a printable **results report** for the submission.
- **Phones**: `/bin` turns a phone into a smart bin with a sorting game;
  `/driver` is the crew app for one truck (`/driver?demo` works offline).

## Keys

| Key | Action |
| --- | --- |
| Space | play / pause |
| 1–5 | simulation speed |
| N | skip to the next shift |
| V | data view (ghost the buildings) |
| C | compare policies |
| L | algorithm lab |
| X | cloud X-Ray |
| G | heatmap (fill → overflow → generated) |
| R | time-lapse replay |
| I | impact (waste-flow Sankey) |
| P | presentation mode (→ next, ← back, Esc end; clickers work) |
| ? | guide |
| Esc | close / clear selection |

## Live mode on AWS

```
devices ─MQTT─▶ IoT Core ─rule─▶ SQS ─▶ ingest λ ─▶ DynamoDB
                                              └──▶ IoT Core ─MQTT─▶ browsers
EventBridge (1/min) ─▶ fleet λ (virtual bins + trucks) ─▶ IoT Core
browsers ─▶ API Gateway ─▶ api λ (state, metrics, operator control)
```

One-time setup (ap-south-1, Mumbai):

```bash
aws configure                                   # access key of an IAM user, region ap-south-1
pnpm --filter @binsight/infra exec cdk bootstrap
pnpm --filter @binsight/infra deploy            # builds the web app, deploys, writes live-config.json
```

Add `-c alertEmail=you@example.com` to the deploy for fire alerts and the $5 budget
alarm by email. The deploy prints the site URL and the commands to create an
operator login. Phones join at `<site>/bin`.
