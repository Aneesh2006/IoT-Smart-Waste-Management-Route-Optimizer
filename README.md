# BinSight: IoT Smart Waste Management & Route Optimizer

A cloud digital twin of a city's waste network: smart bins report their fill
level, a forecaster learns each bin's daily rhythm, and a route optimizer sends
trucks only where they are needed. Built for the BCS VII-semester Cloud Computing
group project.

## Layout

```
apps/web        3D mission-control UI (Vite, React, react-three-fiber)
packages/core   deterministic simulation: city generator, bins, trucks,
                Dijkstra/A*, CVRP solvers, policies, metrics
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
- **Chaos lab**: festival spike, monsoon flooding, truck breakdown, dead sensors,
  bin fire.

## Keys

| Key | Action |
| --- | --- |
| Space | play / pause |
| 1–5 | simulation speed |
| N | skip to the next shift |
| V | data view (ghost the buildings) |
| C | compare policies |
| L | algorithm lab |
| ? | guide |
| Esc | close / clear selection |
