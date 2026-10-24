import { buildAdjacency, isConnected } from './graph.ts';
import { createRng, type Rng } from './rng.ts';
import type {
  BinSite,
  Block,
  Building,
  City,
  DistrictKind,
  Facility,
  RoadEdge,
  RoadNode,
  Tree,
  WasteStream,
} from './types.ts';

export interface CityOptions {
  seed: string;
  /** Intersections per side. Every fourth line is an arterial. */
  grid?: number;
  /** Spacing between intersections, metres. */
  block?: number;
  bins?: number;
}

export const ARTERIAL_SPEED = 40 / 3.6;
export const STREET_SPEED = 25 / 3.6;
export const ROAD_HALF_WIDTH = { arterial: 8, street: 5 } as const;

export const DISTRICT_SHORT: Record<DistrictKind, string> = {
  residential: 'RES',
  market: 'MKT',
  commercial: 'COM',
  institutional: 'INS',
  industrial: 'IND',
  park: 'PRK',
};

const BIN_WEIGHT: Record<DistrictKind, number> = {
  market: 1,
  commercial: 0.75,
  residential: 0.55,
  institutional: 0.45,
  industrial: 0.35,
  park: 0.45,
};

const BIN_CAPACITY: Record<DistrictKind, number> = {
  market: 1100,
  industrial: 1100,
  commercial: 660,
  residential: 660,
  institutional: 660,
  park: 240,
};

const WET_SHARE: Record<DistrictKind, number> = {
  market: 0.65,
  residential: 0.55,
  commercial: 0.4,
  institutional: 0.45,
  industrial: 0.3,
  park: 0.5,
};

/** Voronoi weight: a bigger weight claims a bigger area. */
const DISTRICT_SPREAD: Record<DistrictKind, number> = {
  residential: 1,
  commercial: 0.85,
  industrial: 0.95,
  market: 0.7,
  institutional: 0.75,
  park: 0.6,
};

export function generateCity(options: CityOptions): City {
  const seed = options.seed;
  const grid = options.grid ?? 13;
  const spacing = options.block ?? 120;
  const binTarget = options.bins ?? 120;
  const rng = createRng(seed);
  const rLayout = rng.fork('layout');

  const isArterialLine = (i: number) => i % 4 === 0 || i === grid - 1;

  // --- Intersections. Arterial lines stay straight; side streets wobble a little.
  const colShift = Array.from({ length: grid }, (_, i) => (isArterialLine(i) ? 0 : rLayout.range(-7, 7)));
  const rowShift = Array.from({ length: grid }, (_, j) => (isArterialLine(j) ? 0 : rLayout.range(-7, 7)));
  const nodes: RoadNode[] = [];
  const at = (i: number, j: number) => j * grid + i;
  for (let j = 0; j < grid; j++) {
    for (let i = 0; i < grid; i++) {
      const jitterX = isArterialLine(i) ? 0 : rLayout.range(-5, 5);
      const jitterZ = isArterialLine(j) ? 0 : rLayout.range(-5, 5);
      nodes.push({
        id: nodes.length,
        x: i * spacing + colShift[i] + jitterX,
        z: j * spacing + rowShift[j] + jitterZ,
        kind: 'junction',
      });
    }
  }

  let edges: RoadEdge[] = [];
  const addEdge = (a: number, b: number, arterial: boolean) => {
    const na = nodes[a];
    const nb = nodes[b];
    edges.push({
      id: edges.length,
      a,
      b,
      length: Math.hypot(na.x - nb.x, na.z - nb.z),
      arterial,
      speed: arterial ? ARTERIAL_SPEED : STREET_SPEED,
      closed: false,
    });
  };
  for (let j = 0; j < grid; j++) {
    for (let i = 0; i < grid; i++) {
      if (i + 1 < grid) addEdge(at(i, j), at(i + 1, j), isArterialLine(j));
      if (j + 1 < grid) addEdge(at(i, j), at(i, j + 1), isArterialLine(i));
    }
  }

  // --- Knock out some side streets (plazas, dead ground), never disconnecting the city.
  {
    let adjacency = buildAdjacency(nodes.length, edges);
    const degree = (v: number) => adjacency[v].filter((a) => !edges[a.edge].closed).length;
    for (const e of rLayout.shuffle([...edges])) {
      if (e.arterial || !rLayout.chance(0.13)) continue;
      if (degree(e.a) <= 2 || degree(e.b) <= 2) continue;
      e.closed = true;
      if (!isConnected({ nodes, edges, adjacency })) e.closed = false;
    }
    edges = edges.filter((e) => !e.closed).map((e, id) => ({ ...e, id }));
    adjacency = buildAdjacency(nodes.length, edges);
  }

  // --- Blocks and districts.
  const blocks = buildBlocks(nodes, grid, at, isArterialLine);
  assignDistricts(blocks, grid, rng.fork('districts'));

  // --- Buildings, trees, street lights.
  const center = { x: ((grid - 1) * spacing) / 2, z: ((grid - 1) * spacing) / 2 };
  const { buildings, trees } = buildLots(blocks, center, rng.fork('lots'));
  const streetLights = buildStreetLights(nodes, edges);

  // --- Facilities on access roads outside the grid.
  const facilityNode = (x: number, z: number, kind: RoadNode['kind'], joinTo: number) => {
    const id = nodes.length;
    nodes.push({ id, x, z, kind });
    addEdge(joinTo, id, true);
    return id;
  };
  const mid = Math.floor(grid / 2);
  const west = nodes[at(0, mid)];
  const east = nodes[at(grid - 1, 4)];
  const south = nodes[at(8, grid - 1)];
  const depotNode = facilityNode(west.x - 170, west.z, 'depot', at(0, mid));
  const landfillNode = facilityNode(east.x + 380, east.z, 'landfill', at(grid - 1, 4));
  const recyclingNode = facilityNode(south.x, south.z + 190, 'recycling', at(8, grid - 1));
  const facilityEdgeIds = new Set(edges.slice(-3).map((e) => e.id));
  const facility = (kind: Facility['kind'], name: string, node: number): Facility => ({
    kind,
    name,
    node,
    x: nodes[node].x,
    z: nodes[node].z,
  });

  // --- Bins split road edges so every bin is a routable graph node.
  const bins = placeBins(nodes, edges, blocks, facilityEdgeIds, binTarget, rng.fork('bins'));

  const xs = nodes.map((n) => n.x);
  const zs = nodes.map((n) => n.z);
  return {
    seed,
    nodes,
    edges,
    adjacency: buildAdjacency(nodes.length, edges),
    bounds: { x0: Math.min(...xs), z0: Math.min(...zs), x1: Math.max(...xs), z1: Math.max(...zs) },
    blocks,
    buildings,
    trees,
    streetLights,
    depot: facility('depot', 'Municipal Depot', depotNode),
    landfill: facility('landfill', 'Transfer Station', landfillNode),
    recycling: facility('recycling', 'Recycling Centre', recyclingNode),
    bins,
  };
}

function buildBlocks(
  nodes: RoadNode[],
  grid: number,
  at: (i: number, j: number) => number,
  isArterialLine: (i: number) => boolean,
): Block[] {
  const blocks: Block[] = [];
  const kerb = 3;
  for (let j = 0; j < grid - 1; j++) {
    for (let i = 0; i < grid - 1; i++) {
      const hw = (line: number) => (isArterialLine(line) ? ROAD_HALF_WIDTH.arterial : ROAD_HALF_WIDTH.street);
      const x0 = Math.max(nodes[at(i, j)].x, nodes[at(i, j + 1)].x) + hw(i) + kerb;
      const x1 = Math.min(nodes[at(i + 1, j)].x, nodes[at(i + 1, j + 1)].x) - hw(i + 1) - kerb;
      const z0 = Math.max(nodes[at(i, j)].z, nodes[at(i + 1, j)].z) + hw(j) + kerb;
      const z1 = Math.min(nodes[at(i, j + 1)].z, nodes[at(i + 1, j + 1)].z) - hw(j + 1) - kerb;
      blocks.push({ id: blocks.length, district: 'residential', x0, z0, x1, z1 });
    }
  }
  return blocks;
}

function assignDistricts(blocks: Block[], grid: number, rng: Rng) {
  const cells = grid - 1;
  const c = (cells - 1) / 2;
  type Seed = { kind: DistrictKind; i: number; j: number };
  const seeds: Seed[] = [];
  const near = (radius: number) => ({
    i: c + rng.range(-radius, radius),
    j: c + rng.range(-radius, radius),
  });
  const anywhere = () => ({ i: rng.range(0, cells - 1), j: rng.range(0, cells - 1) });
  seeds.push({ kind: 'commercial', ...near(1.5) });
  seeds.push({ kind: 'commercial', ...near(3) });
  seeds.push({ kind: 'market', ...near(3.5) });
  seeds.push({ kind: 'market', ...near(4.5) });
  seeds.push({ kind: 'institutional', ...anywhere() });
  // The industrial belt sits east, next to the transfer station road.
  seeds.push({ kind: 'industrial', i: rng.range(cells - 3, cells - 1), j: rng.range(1, 6) });
  seeds.push({ kind: 'park', ...anywhere() });
  seeds.push({ kind: 'park', ...anywhere() });
  for (let k = 0; k < 7; k++) seeds.push({ kind: 'residential', ...anywhere() });

  for (const b of blocks) {
    const i = b.id % cells;
    const j = Math.floor(b.id / cells);
    let best = seeds[0];
    let bestScore = Infinity;
    for (const s of seeds) {
      const score = Math.hypot(s.i - i, s.j - j) / DISTRICT_SPREAD[s.kind];
      if (score < bestScore) {
        bestScore = score;
        best = s;
      }
    }
    b.district = best.kind;
  }
}

function buildLots(blocks: Block[], center: { x: number; z: number }, rng: Rng) {
  const buildings: Building[] = [];
  const trees: Tree[] = [];
  const maxDist = Math.hypot(center.x, center.z);

  const fill = (
    b: Block,
    nx: number,
    nz: number,
    occupancy: number,
    footprint: [number, number],
    height: () => number,
  ) => {
    const w = (b.x1 - b.x0) / nx;
    const d = (b.z1 - b.z0) / nz;
    for (let ix = 0; ix < nx; ix++) {
      for (let iz = 0; iz < nz; iz++) {
        if (!rng.chance(occupancy)) continue;
        const fw = w * rng.range(footprint[0], footprint[1]);
        const fd = d * rng.range(footprint[0], footprint[1]);
        const cx = b.x0 + (ix + 0.5) * w + rng.range(-0.5, 0.5) * (w - fw);
        const cz = b.z0 + (iz + 0.5) * d + rng.range(-0.5, 0.5) * (d - fd);
        buildings.push({ x: cx, z: cz, w: fw, d: fd, h: height(), district: b.district });
      }
    }
  };
  const scatterTrees = (b: Block, count: number) => {
    for (let k = 0; k < count; k++) {
      trees.push({
        x: rng.range(b.x0 + 4, b.x1 - 4),
        z: rng.range(b.z0 + 4, b.z1 - 4),
        scale: rng.range(0.75, 1.4),
      });
    }
  };
  const floors = (min: number, max: number) => rng.int(min, max) * 3.2;

  for (const b of blocks) {
    const cx = (b.x0 + b.x1) / 2;
    const cz = (b.z0 + b.z1) / 2;
    const centrality = 1 - Math.hypot(cx - center.x, cz - center.z) / maxDist;
    switch (b.district) {
      case 'commercial':
        fill(b, 2, 2, 0.9, [0.62, 0.86], () => Math.min(140, (22 + Math.exp(rng.normal(3.4, 0.45))) * (0.7 + centrality)));
        break;
      case 'residential':
        fill(b, 3, rng.chance(0.5) ? 3 : 4, 0.88, [0.55, 0.82], () => floors(3, 8));
        if (rng.chance(0.4)) scatterTrees(b, 3);
        break;
      case 'market':
        fill(b, 4, 4, 0.94, [0.72, 0.94], () => floors(1, 3));
        break;
      case 'institutional':
        fill(b, 2, 1, 0.95, [0.45, 0.65], () => floors(4, 7));
        scatterTrees(b, 10);
        break;
      case 'industrial':
        fill(b, 2, 2, 0.85, [0.7, 0.92], () => rng.range(8, 15));
        break;
      case 'park':
        scatterTrees(b, rng.int(22, 36));
        break;
    }
  }
  return { buildings, trees };
}

function buildStreetLights(nodes: RoadNode[], edges: RoadEdge[]) {
  const lights: { x: number; z: number }[] = [];
  for (const e of edges) {
    if (!e.arterial) continue;
    const a = nodes[e.a];
    const b = nodes[e.b];
    const len = e.length;
    const ux = (b.x - a.x) / len;
    const uz = (b.z - a.z) / len;
    const off = ROAD_HALF_WIDTH.arterial + 1.5;
    for (let s = 20; s < len - 10; s += 40) {
      lights.push({ x: a.x + ux * s - uz * off, z: a.z + uz * s + ux * off });
      lights.push({ x: a.x + ux * s + uz * off, z: a.z + uz * s - ux * off });
    }
  }
  return lights;
}

function blockAt(blocks: Block[], x: number, z: number) {
  return blocks.find((b) => x >= b.x0 - 4 && x <= b.x1 + 4 && z >= b.z0 - 4 && z <= b.z1 + 4);
}

function placeBins(
  nodes: RoadNode[],
  edges: RoadEdge[],
  blocks: Block[],
  excluded: Set<number>,
  target: number,
  rng: Rng,
): BinSite[] {
  type Candidate = { edge: RoadEdge; side: number; block: Block; key: number };
  const candidates: Candidate[] = [];
  for (const edge of edges) {
    if (excluded.has(edge.id)) continue;
    const a = nodes[edge.a];
    const b = nodes[edge.b];
    const mx = (a.x + b.x) / 2;
    const mz = (a.z + b.z) / 2;
    const nx = -(b.z - a.z) / edge.length;
    const nz = (b.x - a.x) / edge.length;
    const off = (edge.arterial ? ROAD_HALF_WIDTH.arterial : ROAD_HALF_WIDTH.street) + 6;
    const first = rng.chance(0.5) ? 1 : -1;
    for (const side of [first, -first]) {
      const block = blockAt(blocks, mx + nx * off * side, mz + nz * off * side);
      if (!block) continue;
      // Efraimidis–Spirakis: weighted sampling without replacement.
      candidates.push({ edge, side, block, key: Math.pow(rng.next(), 1 / BIN_WEIGHT[block.district]) });
      break;
    }
  }
  candidates.sort((p, q) => q.key - p.key);
  const chosen = candidates.slice(0, target);

  const bins: BinSite[] = [];
  for (const c of chosen) {
    const { edge, side, block } = c;
    const a = nodes[edge.a];
    const b = nodes[edge.b];
    const t = rng.range(0.3, 0.7);
    const id = nodes.length;
    const x = a.x + (b.x - a.x) * t;
    const z = a.z + (b.z - a.z) * t;
    nodes.push({ id, x, z, kind: 'bin' });
    // Split a–b into a–bin and bin–b.
    const oldB = edge.b;
    const full = edge.length;
    edge.b = id;
    edge.length = full * t;
    edges.push({ ...edge, id: edges.length, a: id, b: oldB, length: full * (1 - t) });

    const nx = -(b.z - a.z) / full;
    const nz = (b.x - a.x) / full;
    const off = (edge.arterial ? ROAD_HALF_WIDTH.arterial : ROAD_HALF_WIDTH.street) + 2.5;
    const district = block.district;
    const stream: WasteStream = rng.chance(WET_SHARE[district]) ? 'wet' : 'dry';
    bins.push({
      id: bins.length,
      node: id,
      x: x + nx * off * side,
      z: z + nz * off * side,
      district,
      stream,
      capacityL: BIN_CAPACITY[district],
      busyness: Math.exp(rng.normal(0, 0.45)),
      label: '',
    });
  }
  // Number bins west→east, north→south so labels read like a street map.
  bins.sort((p, q) => p.z - q.z || p.x - q.x);
  bins.forEach((bin, i) => {
    bin.id = i;
    bin.label = `${DISTRICT_SHORT[bin.district]}-${String(i + 1).padStart(3, '0')}`;
  });
  return bins;
}
