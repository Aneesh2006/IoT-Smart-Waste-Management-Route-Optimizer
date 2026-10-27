# BinSight: Edge Cases

Edge cases are the unusual situations that break naive code: bad input, missing data, failures, races and limits. Every case below was checked against the code. File links point to where it is handled, or to where the gap is.

**Status key**
- ✅ **Handled**: the code deals with it, and a test or guard proves it.
- 🔧 **Fixed**: was pending, now resolved (see "Fix round" below).
- ⚠️ **Accepted**: known limit, deliberately left as is, with the reason given.
- ❌ **Pending**: not handled yet.

**Scope:** this list covers what can go wrong in the code that exists. It leaves out "what if we added feature X", hardware failures outside the simulation, and general AWS outages.

---

## Fix round: what was resolved

| # | Was | Fix | Proof |
| --- | --- | --- | --- |
| P1 | DynamoDB batch writes that AWS only partly accepted were dropped | Rejected items are retried with growing waits. If they still fail after 5 tries, the batch fails so SQS delivers it again (and after 3 failures it goes to the DLQ) | [ingest.ts](services/src/ingest.ts) `batchWrite()` |
| P2 | An older reading could overwrite a newer one | Latest state is saved only if `tDevice` is newer (conditional update), for fleet bins and phones alike | Test: "updates the latest state only when newer" |
| NEW | **Fire alerts repeated on every reading.** Each fleet reading replaced the whole bin row, erasing the "alert already sent" marker | Same fix as P2: an *update* changes only the reading fields, so the marker survives | Found while fixing P2 |
| P3 | A custom policy that loops forever froze the tab during validation | Validation runs in a Web Worker and gives up after 10 s | [PolicyEditor.tsx](apps/web/src/hud/PolicyEditor.tsx) |
| P5 | A full truck "collected" bins without taking anything | A full truck skips the bin and returns it to the planner, with a log message | Test: "a full truck leaves bins for the next plan…" (failed before the fix) |
| P6 | If every truck was out at shift start, the shift was skipped | The shift is planned as soon as a truck is back, while that shift is still on | Test: "plans a missed shift as soon as a truck is back" (failed before the fix) |
| P7 | Readings in the dead-letter queue went unnoticed | A CloudWatch alarm on the DLQ emails via the Alerts topic | [stack.ts](infra/lib/stack.ts), checked with `cdk synth` |
| P8 | Blank screen without WebGL | A plain message explains what to do | [CityCanvas.tsx](apps/web/src/scene/CityCanvas.tsx) |
| P9a | A repaired sensor learned from day-old data | The first hour after repair is skipped | [sim.ts](packages/core/src/sim.ts) |
| P9b | A broken-down truck's load vanished from the totals | Counted as tipped when the truck is towed back | [sim.ts](packages/core/src/sim.ts) |
| P9c | Two festivals stacked to about ×10 | A second festival extends the first instead | [sim.ts](packages/core/src/sim.ts) |
| P9d | A fire could restart on a bin already burning | Only bins not already burning can catch fire | [sim.ts](packages/core/src/sim.ts) |
| P9e | Overflow counter missed overflows after a fire burned out | The overflow flag is cleared when fill drops below 100% | [sim.ts](packages/core/src/sim.ts) |
| P9f | A guest could publish under any city name | IAM now allows the deployed city only | [stack.ts](infra/lib/stack.ts) |
| P9g | Phone rows were never deleted | TTL on the `Bins` table. Phone rows expire a day after their last reading; fleet rows never do | [stack.ts](infra/lib/stack.ts), [ingest.ts](services/src/ingest.ts) |
| P9i | Bad JSON to `/control` returned 500 | Returns 400 "Body must be a JSON object" | [api.ts](services/src/api.ts) |
| — | `?threshold=` wasn't clamped | Clamped to 0.4–0.95, same as the slider | [store.ts](apps/web/src/state/store.ts) |

**Checks run:** types pass in all 4 packages, **25/25 tests** pass (3 new), the web production build passes, and `cdk synth` passes. Nothing has been deployed to AWS.

## Still open, on purpose

| # | Case | Why it's left |
| --- | --- | --- |
| P4 | A guest can flood MQTT; the $5 budget only emails | AWS IoT Core has no per-client rate limit to configure. A real kill switch (a Budgets action that blocks the guest role) can only be tested by deploying and overspending. Worth adding before a public demo, not for a class project |
| P9h | Trucks may pause for about a second at each minute boundary in Live mode | Cosmetic |
| — | Two operators editing at the same moment: last write wins | One operator in practice |
| — | `events` list grows with many chaos clicks (DynamoDB item limit is 400 KB) | Operator-only, and cleared on reset and every 14 sim-days |
| — | No shift-end cutoff: a long route runs past noon | Design choice. Collection finishes rather than abandoning bins halfway |
| — | A locked phone still shows as present for up to 2 h | Needs a heartbeat from the phone. Low value |
| — | An installed custom policy could still loop on some *other* city state at shift time | Validation tests it on a hidden 3-day city only. It's the author's own code on their own page |

---

## 1. City generation ([city.ts](packages/core/src/city.ts))

| Edge case | What happens | Status |
| --- | --- | --- |
| Removing streets would split the city in two | Each removal is checked with `isConnected()` and undone if it disconnects anything | ✅ Tested |
| Removing a street would leave a dead end | Roads at junctions with 2 or fewer connections are never removed | ✅ |
| Same seed must give the same city | Seeded generator with a separate random stream for each subsystem | ✅ Tested |
| More bins requested than there are road segments | The grid grows with the bin count. Bins are clamped to 20–400 (URL) and 20–1000 (Live API) | ✅ by sizing |
| A bin must be reachable by trucks | Each bin splits a road and becomes a stop on the road map | ✅ Tested |
| Bins on the facility access roads | Excluded | ✅ |

## 2. Waste, sensors and forecasting ([sim.ts](packages/core/src/sim.ts))

| Edge case | What happens | Status |
| --- | --- | --- |
| A bin fills past 100% | The extra counts as litter. The reading is capped at 130% | ✅ |
| Sensor noise makes a reading negative | Clamped to 0–1.3 | ✅ |
| Sensor goes dead | Every sensor-based policy collects the bin "blind" | ✅ |
| Forecaster mistakes a pickup for "negative waste" | Learning is skipped for that hour | ✅ |
| Forecast is scored across a pickup | Ignored | ✅ |
| Weekend vs weekday rhythm | Learned separately | ✅ |
| Sensor comes back after 24 h dead | The first hour back isn't learned from | 🔧 P9a |
| A bin is bigger than its original size | It fills proportionally slower. Unknown ids are skipped | ✅ Tested |
| Endless history growth | Every history list is capped | ✅ |

## 3. Policies ([policies.ts](packages/core/src/policies.ts), [compare.ts](packages/core/src/compare.ts))

| Edge case | What happens | Status |
| --- | --- | --- |
| Policy picks no bins | Logged. No trucks are sent | ✅ |
| Dynamic re-plans for a single bin | Needs 3 or more bins, or one already overflowing | ✅ |
| Dynamic re-plans right after the shift plan | Not in the first 30 minutes of a shift | ✅ |
| Custom policy has a syntax error | Rejected, and the previous policy is kept | ✅ Tested |
| Custom policy returns bad values | Throws, or skips the bad ids. Duplicates removed | ✅ Tested |
| Custom policy crashes during its test run | Rejected | ✅ |
| Custom policy never collects, or causes heavy litter | Warning shown, but still allowed | ✅ |
| Custom policy loops forever during validation | Worker plus a 10 s time limit | 🔧 P3 |
| Custom policy loops only on some later city state | It would freeze the page at that shift | ⚠️ Accepted |
| Custom policy runs arbitrary JavaScript | Only on the author's own page. Not accepted from links or the Live API | ✅ |
| Fair comparison between policies | Same seed, same waste | ✅ Tested |

## 4. Routing ([graph.ts](packages/core/src/graph.ts), [cvrp.ts](packages/core/src/routing/cvrp.ts), [tsp.ts](packages/core/src/routing/tsp.ts))

| Edge case | What happens | Status |
| --- | --- | --- |
| Shortest path is wrong | Checked against Bellman–Ford | ✅ Tested |
| Closed (flooded) road | Skipped by every search. Distance cache cleared | ✅ |
| A stop can't be reached | Skipped and logged. The bin goes back into the pool | ✅ |
| One bin holds more than the truck | Demand capped at truck capacity | ✅ |
| Trips over capacity | Never | ✅ Tested |
| Every bin visited exactly once | Yes | ✅ Tested |
| Empty route / zero stops | Handled | ✅ |
| Exact solver on too many bins | Throws above 16. The lab caps it at 12 | ✅ |
| Heuristic beats the exact answer | Never | ✅ Tested |
| Fewer idle trucks than needed | Trucks work past the shift end | ⚠️ Accepted (design) |

## 5. Trucks and the simulation loop ([sim.ts](packages/core/src/sim.ts))

| Edge case | What happens | Status |
| --- | --- | --- |
| Truck carries more than capacity | Never | ✅ Tested |
| Truck fills up mid-trip | Skips the remaining bins and returns them to the planner | 🔧 P5 Tested |
| Every truck still out at shift start | Planned as soon as one is back | 🔧 P6 Tested |
| Truck breaks down with bins left | Its bins are released. Towed back after 4 h | ✅ |
| Truck breaks down while loaded | The load counts as tipped on return | 🔧 P9b |
| No truck to break | Logged | ✅ |
| Flood while trucks are driving | Every moving truck is re-routed | ✅ |
| Flood would cut the city in two | Roads close only if the city stays connected | ✅ |
| Flood on depot or facility roads | Excluded | ✅ |
| Two floods at once | Independent closures and timers | ✅ |
| Two festivals at once | The second extends the first instead of multiplying | 🔧 P9c |
| Fire on a bin that is already burning | Not possible | 🔧 P9d |
| Fire with no free truck | Gets the next idle truck | ✅ |
| Fire burns out | Overflow flag cleared when fill < 100% | 🔧 P9e |
| All sensors dead | Up to 8 per event. Repaired after 24 h | ✅ |

## 6. Cloud ingest ([ingest.ts](services/src/ingest.ts), [ingest-logic.ts](services/src/ingest-logic.ts))

| Edge case | What happens | Status |
| --- | --- | --- |
| Invalid JSON, `null`, missing id or city | Rejected | ✅ Tested |
| Absurd values | Clamped | ✅ Tested |
| Device clock wrong | Clamped to the window from 1 h ago to 1 min ahead | ✅ |
| Nickname with HTML or a long emoji | Cleaned and shortened | ✅ |
| Phone pretends to be another bin | IAM topic restriction. The id comes from the topic | ✅ |
| Phone pretends to be a fleet bin | Impossible | ✅ |
| Phone publishes under another city name | IAM allows the deployed city only | 🔧 P9f |
| Several readings from one bin in one batch | Newest kept | ✅ Tested |
| An older reading arrives in a later batch | Ignored: newer-only conditional update | 🔧 P2 Tested |
| DynamoDB throttles part of a batch write | Retried, then the batch fails so SQS redelivers it | 🔧 P1 |
| Lambda fails mid-batch | Whole batch retried. Writes are idempotent and alerts de-duplicated | ✅ |
| Fire alert repeats on every reading | Alert marker no longer erased | 🔧 NEW |
| A message keeps failing | Goes to the DLQ after 3 tries | ✅ |
| …and then sits in the DLQ | Alarm emails the Alerts topic | 🔧 P7 |
| Duplicate truck dispatch to a phone | Claimed once per 3 min | ✅ |
| "Collected" message from a phone is lost (QoS 0) | Heals itself after 3 min | ✅ |
| Phone closes its tab | Hidden after 2 h, deleted by TTL after a day | 🔧 P9g |
| Old readings fill the database | `Readings` expire after 3 days | ✅ |
| Readings from a previous world after reset | Filtered by world key | ✅ |

## 7. Virtual fleet Lambda ([fleet.ts](services/src/fleet.ts))

| Edge case | What happens | Status |
| --- | --- | --- |
| Lambda crashes or cold-starts | Rebuilt from the control record by replay | ✅ |
| Two runs overlap | DynamoDB lease, so only one drives the fleet | ✅ |
| Lambda times out mid-loop | Stops while at least 2.5 s remain | ✅ |
| Replay gets slower over time | World resets after 14 sim-days | ✅ |
| Operator changes mid-run | Picked up within about 4 s, applied at the same tick in every replay | ✅ |
| Browser joins late | Routes published retained | ✅ |
| Gap between minute runs | Brief pause possible | ⚠️ Accepted (P9h) |
| Run stopped by an operator | Exits within about 4 s | ✅ |

## 8. HTTP API ([api.ts](services/src/api.ts))

| Edge case | What happens | Status |
| --- | --- | --- |
| Control without signing in | Rejected by the Cognito authorizer | ✅ |
| Unknown action, policy or chaos kind | 400 | ✅ |
| Speed, bins or trucks out of range | Clamped | ✅ |
| Seed with odd characters | Cleaned | ✅ |
| Body isn't valid JSON, or isn't an object | 400 | 🔧 P9i |
| Two operators at the same moment | Last write wins | ⚠️ Accepted |
| Many chaos clicks | List grows until the next reset | ⚠️ Accepted |
| Request flood | Throttled to 25 requests/s | ✅ |

## 9. Browser and phones ([apps/web](apps/web/src/))

| Edge case | What happens | Status |
| --- | --- | --- |
| MQTT connection drops | Reconnects every 2.5 s | ✅ |
| Guest credentials expire | Refreshed before expiry | ✅ |
| Same person opens two tabs | Unique client id per tab | ✅ |
| Operator token expires | "Session expired" shown | ✅ |
| Browser clock is wrong | Offset from `GET /time` | ✅ |
| Message from an old world | Ignored, and the city rebuilds | ✅ Tested |
| Phones placed differently on each screen | Same placement everywhere | ✅ Tested |
| Bad URL parameters | Whitelisted or clamped | ✅ |
| `?threshold=` out of range | Clamped to 0.4–0.95 | 🔧 |
| Negative or NaN cost assumptions | Rejected | ✅ |
| Slow laptop or projector | Switches to performance mode | ✅ |
| No WebGL | Message shown | 🔧 P8 |
| Heavy Compare runs | Run in a Web Worker | ✅ |
| No internet during a demo | Service worker precache | ✅ |
| Stale app after a new deploy | Shell revalidated, old caches deleted | ✅ |
| Phone denies motion permission | Tap game still works | ✅ |
| Phone screen locks | Still shows as present for up to 2 h | ⚠️ Accepted |
| Phones download the 3D engine | Separate bundle | ✅ |

## 10. Cost and security ([stack.ts](infra/lib/stack.ts))

| Edge case | What happens | Status |
| --- | --- | --- |
| Website bucket exposed | Private, CloudFront only, HTTPS | ✅ |
| Operator sign-up by strangers | Disabled | ✅ |
| Guest floods MQTT | Budget alarm emails but doesn't stop anything | ❌ P4 (see "Still open") |
| Logs grow forever | Retained for 1 week | ✅ |
| Bill surprise after the course | `cdk destroy` removes everything | ✅ |

---

## Tally

| Status | Count |
| --- | --- |
| ✅ Handled | 85 |
| 🔧 Fixed in this round | 17 |
| ⚠️ Accepted | 6 |
| ❌ Pending | 1 (P4) |
