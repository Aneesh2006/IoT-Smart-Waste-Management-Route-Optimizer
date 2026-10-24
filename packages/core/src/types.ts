/** World units are metres. The ground plane is x (east) by z (south). */

export type DistrictKind =
  | 'residential'
  | 'market'
  | 'commercial'
  | 'institutional'
  | 'industrial'
  | 'park';

export type NodeKind = 'junction' | 'bin' | 'depot' | 'landfill' | 'recycling';

export type WasteStream = 'wet' | 'dry';

export interface RoadNode {
  id: number;
  x: number;
  z: number;
  kind: NodeKind;
}

export interface RoadEdge {
  id: number;
  a: number;
  b: number;
  length: number;
  arterial: boolean;
  /** Free-flow speed in m/s. */
  speed: number;
  /** Closed roads are skipped by every path search (monsoon flooding, works). */
  closed: boolean;
}

export interface Arc {
  to: number;
  edge: number;
}

export interface Graph {
  nodes: RoadNode[];
  edges: RoadEdge[];
  adjacency: Arc[][];
}

export interface Block {
  id: number;
  district: DistrictKind;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export interface Building {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  district: DistrictKind;
}

export interface Tree {
  x: number;
  z: number;
  scale: number;
}

export type FacilityKind = 'depot' | 'landfill' | 'recycling';

export interface Facility {
  kind: FacilityKind;
  name: string;
  node: number;
  x: number;
  z: number;
}

export interface BinSite {
  id: number;
  /** Graph node the bin sits on (bins split road edges). */
  node: number;
  /** Kerbside position, offset from the road centre line. */
  x: number;
  z: number;
  district: DistrictKind;
  stream: WasteStream;
  capacityL: number;
  /** Per-bin multiplier on the district's waste rate (some corners are just busier). */
  busyness: number;
  label: string;
}

export interface City extends Graph {
  seed: string;
  bounds: { x0: number; z0: number; x1: number; z1: number };
  blocks: Block[];
  buildings: Building[];
  trees: Tree[];
  streetLights: { x: number; z: number }[];
  depot: Facility;
  landfill: Facility;
  recycling: Facility;
  bins: BinSite[];
}
