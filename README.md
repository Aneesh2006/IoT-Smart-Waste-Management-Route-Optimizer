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

Add `?seed=anything` to the URL to build a different (but reproducible) city.

## Keys

| Key | Action |
| --- | --- |
| Space | play / pause |
| 1–5 | simulation speed |
| N | skip to the next shift |
| V | data view (ghost the buildings) |
| Esc | clear selection |
