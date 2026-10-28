# BinSight: IoT Smart Waste Management & Route Optimizer

A cloud digital twin of a city's waste network: smart bins report their fill
level, a forecaster learns each bin's daily rhythm, and a route optimizer sends
trucks only where they are needed. Built for the BCS VII-semester Cloud Computing
group project.

This branch runs on **Vercel + MongoDB Atlas + Ably**. The original AWS version
(IoT Core, SQS, Lambda, DynamoDB, Cognito, CDK) is preserved at the `aws-version`
tag.

## Layout

```
apps/web        3D mission-control UI (Vite, React, react-three-fiber), the /bin and /driver phone pages
packages/core   deterministic simulation: city generator, bins, trucks,
                Dijkstra/A*, CVRP solvers, policies, metrics, live-mode contract
services        the cloud: ingest (readings → MongoDB → Ably), fleet (lazy tick of the
                virtual bins and trucks), api (state, metrics, auth, operator control)
api/[route].js  the Vercel function: a thin wrapper over services (bundled by `pnpm build`)
vercel.json     build, SPA rewrites for /bin and /driver, the daily cron backup
```

## Run it

```bash
pnpm install
pnpm dev        # Sandbox only: http://localhost:5173
pnpm dev:live   # Sandbox + Live mode: the API on :3001 behind Vite's /api proxy
pnpm test       # core, web and service tests (services use an in-memory MongoDB)
pnpm typecheck
pnpm sim        # one seeded week under every policy, as a table
```

`pnpm dev:live` works with nothing configured: it starts a throwaway in-memory
MongoDB, pushes realtime messages over a local Server-Sent Events bus instead of
Ably, and prints a one-off operator password. Copy `.env.example` to `.env` to
point it at Atlas and Ably instead. Phones on the same Wi-Fi can open
`http://<laptop-ip>:5173/bin`.

`vercel dev` also works once the project is linked (`vercel link`, which needs
a Vercel login): run `pnpm --filter @binsight/services build` first, since the
function imports the bundled services.

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
- **Cloud X-Ray** (`X`): readings flying through the pipeline (device → ingest
  function → MongoDB → Ably → this screen), timed hop by hop, with the pipeline's
  counters in Live mode and a cost meter for any city size. The boxes, hops and
  series come from [pipeline.ts](apps/web/src/live/pipeline.ts).
- **Heatmap** (`G`), **time-lapse replay** (`R`), **minimap**, and a **command
  palette** (`/` or Ctrl+K) to find any bin or truck.
- **Impact** (`I`): waste-flow Sankey, a Gantt of the fleet's day, and a
  capacity planner that tests bigger bins on a seeded week.
- **Bin inspector** tabs for the sensor hardware and the message on the wire.
- **Presentation mode** (`P`), optional sound cues, automatic performance mode,
  and a printable **results report** for the submission.
- **Offline**: production builds precache the whole app with a service worker, so
  Sandbox works without a network (the `/api` routes are never cached).
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

## Live mode architecture

```
phones (/bin) ─HTTPS POST─▶ ƒ /api/ingest ─▶ MongoDB Atlas ─▶ Ably ─▶ browsers, /driver
                                  │              (bins, readings,   └──▶ phone's own channel (truck dispatch)
                                  │               control, metrics)
                                  └─▶ inbox (retry, pause) ─▶ deadLetters after 3 tries
API requests + browsers' 1/s /api/tick ─▶ lazy fleet tick (virtual bins + trucks) ─▶ ingest in-process
Vercel Cron (daily) ─▶ /api/cron (backup tick, drains the inbox)
```

- **One Vercel function** ([api/[route].js](api/[route].js)) serves every
  `/api/<route>`; [services/src/api.ts](services/src/api.ts) routes it. One
  function means warm instances share the MongoDB pool and the fleet simulation.
- **MongoDB Atlas** via the official driver, one cached client per instance
  ([db.ts](services/src/db.ts)), indexes created on first use, TTL indexes expire
  readings (3 days), phones (1 day after their last reading) and counters.
- **Ingest**: phones POST readings with a signed phone id (from `/api/phone`), so
  nobody can report as another phone or as a fleet bin. Readings are acknowledged
  only once stored, or once parked in the `inbox` collection when ingest is paused
  or a write fails; the phone keeps its latest reading and retries until
  acknowledged. Why not route readings through Ably and a webhook: an HTTP POST
  gives the device a real acknowledgement, Ably's queues need a paid plan and a
  long-running consumer, and this keeps one hop fewer and no extra message cost.
- **Ably** carries the same logical topics as before (`binsight/{city}/state`,
  `fleet`, `routes`, `events`, `alerts`, `phones/{id}/cmd`) as channels in the
  `binsight:` namespace. The server publishes with `ABLY_API_KEY`; browsers and
  phones get one-hour subscribe-only token requests from `/api/realtime-token`.
- **Lazy fleet tick** ([fleet.ts](services/src/fleet.ts)): the free Vercel plan
  only runs cron daily and functions can't loop, so every API request may advance
  the virtual fleet to "now". A tick needs a MongoDB lease and at least a second
  since the last tick, so many browsers still move the city once. The simulation
  is deterministic: a cold instance replays from the control record, a warm one
  just advances. Each tick ingests the readings sampled since the last tick and
  publishes a fleet frame, new routes and events, then drains the inbox.
- **Operators** sign in with `OPERATOR_PASSWORD` and get a signed HttpOnly,
  SameSite=Strict session cookie (8 h); `/api/control` refuses without it.
- **Fire alerts** are POSTed to `ALERT_WEBHOOK_URL` if set (Slack, Discord, or a
  Zapier/Make webhook that emails you). There is no budget alarm: the free tiers
  of Vercel, Atlas M0 and Ably stop at their limits instead of billing.

### API

| Route | |
| --- | --- |
| `GET /api/live-config` | city and realtime mode, or what's missing |
| `GET /api/time` | server clock for hop timings |
| `GET /api/state` | control, bins and current routes (ticks first) |
| `GET /api/config` | control record (ticks first) |
| `POST /api/tick` | advance the fleet if due |
| `GET /api/metrics` | per-minute counters, inbox and dead-letter depth |
| `GET /api/realtime-token` | Ably token request |
| `POST /api/phone` | a signed phone id |
| `POST /api/ingest` | one phone reading (`Authorization: Bearer <phone token>`) |
| `POST /api/login`, `POST /api/logout`, `GET /api/session` | operator session |
| `POST /api/control` | operator actions: start, stop, speed, policy, chaos, reset, ingest pause |
| `GET /api/cron` | Vercel Cron backup tick (checks `CRON_SECRET` if set) |

## Deploy to Vercel

1. **MongoDB Atlas**: create a cluster (M0 is enough for the demo), a database
   user, and allow access from anywhere (`0.0.0.0/0`, Vercel has no fixed IPs).
   Copy the connection string.
2. **Ably**: create an app and an API key with publish and subscribe.
3. **Vercel**: import the repository with the root directory as is. `vercel.json`
   sets the install and build commands and the output directory. Add the
   environment variables from [.env.example](.env.example): `MONGODB_URI`,
   `ABLY_API_KEY`, `OPERATOR_PASSWORD`, `SESSION_SECRET` (32+ random bytes), and
   optionally `ALERT_WEBHOOK_URL`, `CRON_SECRET`, `CITY`. Also set
   `ENABLE_EXPERIMENTAL_COREPACK=1` so Vercel uses the pnpm version pinned in
   `package.json`.
4. Deploy. Open the site, switch to **Live**, sign in with the operator password
   and press **Start fleet**. Phones join at `<site>/bin`, crews at `<site>/driver`.

The collections and indexes are created on the first request.

## Known differences from the AWS version

- Trucks get a fleet frame about once a second (AWS: twice), interpolated in the
  browser. The fleet only moves while someone has the dashboard, `/driver` or the
  API open; when nobody is watching it catches up on the next request.
- A cold function replays the city from scratch: under half a second for 120 bins
  even two sim-weeks in, but several seconds for a 1000-bin world.
- Fleet bins are simulated inside the function, so their device → ingest hop is
  ~0 ms; phones show the real HTTPS hop.
- Rate limiting is per function instance (10 readings/s per phone), not global.
