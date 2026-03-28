export type HoseLeakLevel = 0 | 1 | 2 | 3;
export type TrafficLoadLevel = 0 | 1 | 2;

export type PointNodeId = "P1" | "P2" | "P3" | "P4";
export type ExitNodeId = "EXIT";
export type NodeId = PointNodeId | ExitNodeId;

export type PointData = {
  id: PointNodeId;
  label: string;
  rainfall: number;
  soil: number;
  sand: number;
  hoseLeak: HoseLeakLevel;
  excavation: boolean;
  trafficLoad: TrafficLoadLevel;
  peopleCount: number;
  limitSRI: number;
};

export type SriBand = "low" | "mid" | "high";

export type SriMetrics = {
  R: number;
  f: number;
  T: number;
  L: number;
  E: number;
  D: number;
  P: number;
  raw: number;
  SRI: number;
};

export type Edge = {
  a: NodeId;
  b: NodeId;
  distance: number;
};

export type NodePosition = {
  x: number;
  y: number;
};

export const POINT_IDS: PointNodeId[] = ["P1", "P2", "P3", "P4"];
export const ALL_NODES: NodeId[] = ["P1", "P2", "P3", "P4", "EXIT"];

export const L_MAP: Record<HoseLeakLevel, number> = {
  0: 0,
  1: 0.3,
  2: 0.6,
  3: 1,
};

export const D_MAP: Record<TrafficLoadLevel, number> = {
  0: 0,
  1: 0.5,
  2: 1,
};

export const EDGES_DEFAULT: Edge[] = [
  { a: "P1", b: "P2", distance: 3 },
  { a: "P1", b: "P3", distance: 4 },
  { a: "P2", b: "P4", distance: 5 },
  { a: "P3", b: "P4", distance: 2 },
  { a: "P1", b: "P4", distance: 6 },
  { a: "P2", b: "P3", distance: 7 },
  { a: "P3", b: "EXIT", distance: 6 },
  { a: "P4", b: "EXIT", distance: 1 },
];

export const NODE_POSITIONS: Record<NodeId, NodePosition> = {
  P1: { x: 90, y: 80 },
  P2: { x: 350, y: 70 },
  P3: { x: 105, y: 290 },
  P4: { x: 390, y: 275 },
  EXIT: { x: 230, y: 470 },
};

export const clamp = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, v));

export const clip01 = (v: number) => clamp(v, 0, 1);

export function sriBand(sri: number, limitSRI: number): SriBand {
  if (sri <= limitSRI * 0.45) return "low";
  if (sri < limitSRI) return "mid";
  return "high";
}

export function makeInitialPoints(): PointData[] {
  return [
    {
      id: "P1",
      label: "1",
      rainfall: 220,
      soil: 70,
      sand: 30,
      hoseLeak: 1,
      excavation: false,
      trafficLoad: 0,
      peopleCount: 18,
      limitSRI: 6.6,
    },
    {
      id: "P2",
      label: "2",
      rainfall: 420,
      soil: 55,
      sand: 45,
      hoseLeak: 2,
      excavation: false,
      trafficLoad: 1,
      peopleCount: 27,
      limitSRI: 7.0,
    },
    {
      id: "P3",
      label: "3",
      rainfall: 300,
      soil: 80,
      sand: 20,
      hoseLeak: 1,
      excavation: true,
      trafficLoad: 1,
      peopleCount: 21,
      limitSRI: 6.8,
    },
    {
      id: "P4",
      label: "4",
      rainfall: 160,
      soil: 50,
      sand: 50,
      hoseLeak: 0,
      excavation: false,
      trafficLoad: 0,
      peopleCount: 13,
      limitSRI: 6.4,
    },
  ];
}

export function computeSRI(p: PointData): SriMetrics {
  const R = Math.min(p.rainfall / 1000, 1);

  const denom = p.soil + p.sand;
  const f = denom > 0 ? p.soil / denom : 0;
  const T = clip01((f - 0.25) / 0.5);

  const L = L_MAP[p.hoseLeak];
  const E = p.excavation ? 1 : 0;
  const D = D_MAP[p.trafficLoad];
  const P = clip01(p.peopleCount / 50);

  const raw = 2.6 * R + 2.2 * T + 1.8 * L + 1.0 * E + 1.4 * D + 1.0 * P;
  const SRI = Math.min(10, raw);

  return { R, f, T, L, E, D, P, raw, SRI };
}

export function nodeFactorByRisk(sri: number, limitSRI: number): number {
  if (sri >= limitSRI) return 5.0;
  const ratio = clip01(sri / limitSRI);
  return 1 + 1.8 * ratio;
}

export function edgeRealWeight(
  edge: Edge,
  sriMap: Record<PointNodeId, number>,
  limitMap: Record<PointNodeId, number>
) {
  const dw = edge.distance;

  const fa = edge.a === "EXIT" ? 1 : nodeFactorByRisk(sriMap[edge.a], limitMap[edge.a]);
  const fb = edge.b === "EXIT" ? 1 : nodeFactorByRisk(sriMap[edge.b], limitMap[edge.b]);

  const edgeFactor = (fa + fb) / 2;

  return {
    defaultWeight: dw,
    realWeight: dw * edgeFactor,
  };
}

export function buildAdjacency(edges: Edge[]) {
  const adj: Record<NodeId, Array<{ to: NodeId; edge: Edge }>> = {
    P1: [],
    P2: [],
    P3: [],
    P4: [],
    EXIT: [],
  };

  for (const e of edges) {
    adj[e.a].push({ to: e.b, edge: e });
    adj[e.b].push({ to: e.a, edge: e });
  }

  return adj;
}

export type PathResult = { path: NodeId[]; cost: number } | null;

export function dijkstra(
  start: NodeId,
  target: NodeId,
  adj: Record<NodeId, Array<{ to: NodeId; edge: Edge }>>,
  weightFn: (edge: Edge) => number
): PathResult {
  const dist: Record<NodeId, number> = {
    P1: Infinity,
    P2: Infinity,
    P3: Infinity,
    P4: Infinity,
    EXIT: Infinity,
  };

  const prev: Partial<Record<NodeId, NodeId>> = {};
  const visited = new Set<NodeId>();
  dist[start] = 0;

  while (visited.size < ALL_NODES.length) {
    let u: NodeId | null = null;
    let best = Infinity;

    for (const n of ALL_NODES) {
      if (!visited.has(n) && dist[n] < best) {
        best = dist[n];
        u = n;
      }
    }

    if (u === null || best === Infinity) break;

    visited.add(u);

    if (u === target) {
      const path: NodeId[] = [];
      let cur: NodeId | undefined = u;
      while (cur) {
        path.push(cur);
        cur = prev[cur];
      }
      path.reverse();
      return { path, cost: dist[u] };
    }

    for (const { to, edge } of adj[u]) {
      if (visited.has(to)) continue;
      const alt = dist[u] + weightFn(edge);
      if (alt < dist[to]) {
        dist[to] = alt;
        prev[to] = u;
      }
    }
  }

  return null;
}

export function dijkstraWithPriority(
  start: PointNodeId,
  target: "EXIT",
  adj: Record<"P1" | "P2" | "P3" | "P4" | "EXIT", Array<{ to: "P1" | "P2" | "P3" | "P4" | "EXIT"; edge: any }>>,
  blockedNodes: Set<PointNodeId>,
  sriMap: Record<PointNodeId, number>,
  limitMap: Record<PointNodeId, number>
) {
  const allNodes: ("P1" | "P2" | "P3" | "P4" | "EXIT")[] = ["P1", "P2", "P3", "P4", "EXIT"];

  const dist: Record<"P1" | "P2" | "P3" | "P4" | "EXIT", number> = {
    P1: Infinity,
    P2: Infinity,
    P3: Infinity,
    P4: Infinity,
    EXIT: Infinity,
  };

  const prev: Partial<Record<"P1" | "P2" | "P3" | "P4" | "EXIT", "P1" | "P2" | "P3" | "P4" | "EXIT">> = {};
  const visited = new Set<"P1" | "P2" | "P3" | "P4" | "EXIT">();

  dist[start] = 0;

  while (visited.size < allNodes.length) {
    let u: "P1" | "P2" | "P3" | "P4" | "EXIT" | null = null;
    let best = Infinity;

    for (const n of allNodes) {
      if (!visited.has(n) && dist[n] < best) {
        best = dist[n];
        u = n;
      }
    }

    if (u === null || best === Infinity) break;

    visited.add(u);

    if (u === target) {
      const path: ("P1" | "P2" | "P3" | "P4" | "EXIT")[] = [];
      let cur: "P1" | "P2" | "P3" | "P4" | "EXIT" | undefined = u;

      while (cur) {
        path.push(cur);
        cur = prev[cur];
      }

      path.reverse();
      return { path, cost: dist[u] };
    }

    for (const { to, edge } of adj[u]) {
      if (visited.has(to)) continue;

      if (to !== "EXIT" && blockedNodes.has(to)) continue;

      const baseWeight = edge.distance;
      const safetyPenalty =
        to === "EXIT" ? 0 : (sriMap[to] / Math.max(limitMap[to], 0.0001)) * 0.001;

      const alt = dist[u] + baseWeight + safetyPenalty;

      if (alt < dist[to]) {
        dist[to] = alt;
        prev[to] = u;
      }
    }
  }

  return null;
}

export function randomTraffic(): TrafficLoadLevel {
  const r = Math.random();
  if (r < 0.4) return 0;
  if (r < 0.8) return 1;
  return 2;
}

export function randomPeople(prev: number) {
  const delta = Math.floor(Math.random() * 11) - 5;
  return clamp(prev + delta, 0, 60);
}

export function getPathEdgeKeys(path: NodeId[]) {
  const s = new Set<string>();
  for (let i = 0; i < path.length - 1; i += 1) {
    s.add([path[i], path[i + 1]].sort().join("-"));
  }
  return s;
}