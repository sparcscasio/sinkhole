import { useMemo } from "react";
import {
  NODE_POSITIONS,
  type Edge,
  type PointData,
  type PointNodeId,
  type SriBand,
} from "../sim/shared";

type EvacDot = {
  id: string;
  progress: number;
  speed: number;
  path: (PointNodeId | "EXIT")[];
};

function getNodeCenter(nodeId: PointNodeId | "EXIT") {
  return NODE_POSITIONS[nodeId];
}

function getPathSegments(path: (PointNodeId | "EXIT")[]) {
  const segments: Array<{
    from: { x: number; y: number };
    to: { x: number; y: number };
    length: number;
  }> = [];

  for (let i = 0; i < path.length - 1; i++) {
    const from = getNodeCenter(path[i]);
    const to = getNodeCenter(path[i + 1]);
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.sqrt(dx * dx + dy * dy);

    segments.push({ from, to, length });
  }

  return segments;
}

function getPointOnPath(path: (PointNodeId | "EXIT")[], progress: number) {
  const segments = getPathSegments(path);

  if (segments.length === 0) {
    return getNodeCenter(path[0]);
  }

  const totalLength = segments.reduce((sum, seg) => sum + seg.length, 0);
  const targetLength = totalLength * progress;

  let acc = 0;

  for (const seg of segments) {
    if (acc + seg.length >= targetLength) {
      const local = (targetLength - acc) / seg.length;
      return {
        x: seg.from.x + (seg.to.x - seg.from.x) * local,
        y: seg.from.y + (seg.to.y - seg.from.y) * local,
      };
    }
    acc += seg.length;
  }

  return segments[segments.length - 1].to;
}

export default function GraphView(props: {
  edges: Edge[];
  pathEdgeKeys: Set<string>;
  points: PointData[];
  sriMap: Record<PointNodeId, number>;
  bandMap: Record<PointNodeId, SriBand>;
  evacDots: EvacDot[];
}) {
  const { edges, pathEdgeKeys, points, sriMap, bandMap, evacDots } = props;

  const pointMap = useMemo(
    () =>
      points.reduce((acc, p) => {
        acc[p.id] = p;
        return acc;
      }, {} as Record<PointNodeId, PointData>),
    [points]
  );

  return (
    <svg
      viewBox="0 0 480 560"
      style={{
        ...styles.graphSvg,
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        zIndex: 1,
        background: "transparent",
      }}
    >
      {edges.map((edge, idx) => {
        const p1 = NODE_POSITIONS[edge.a];
        const p2 = NODE_POSITIONS[edge.b];
        const isActive = pathEdgeKeys.has([edge.a, edge.b].sort().join("-"));

        return (
          <g key={`${edge.a}-${edge.b}-${idx}`}>
            <line
              x1={p1.x}
              y1={p1.y}
              x2={p2.x}
              y2={p2.y}
              stroke={isActive ? "#2563EB" : "#111827"}
              strokeWidth={isActive ? 4 : 2.2}
              strokeLinecap="round"
            />
          </g>
        );
      })}

      {evacDots.map((dot, index) => {
        const pos = getPointOnPath(dot.path, dot.progress);
        const offsetX = ((index % 3) - 1) * 4;
        const offsetY = (Math.floor(index / 3) % 3 - 1) * 4;

        return (
          <circle
            key={dot.id}
            cx={pos.x + offsetX}
            cy={pos.y + offsetY}
            r={5}
            fill="#3B82F6"
            stroke="#FFFFFF"
            strokeWidth={2}
          />
        );
      })}

      {(["P1", "P2", "P3", "P4"] as const).map((id) => {
        const pos = NODE_POSITIONS[id];
        const p = pointMap[id];
        const band = bandMap[id];

        const fill =
          band === "high"
            ? "rgba(252,165,165,1)"
            : band === "mid"
            ? "rgba(253,230,138,1)"
            : "rgba(167,243,208,1)";

        const stroke =
          band === "high"
            ? "#EF4444"
            : band === "mid"
            ? "#F59E0B"
            : "#10B981";

        return (
          <g key={id}>
            <circle cx={pos.x} cy={pos.y} r={52} fill={fill} stroke={stroke} strokeWidth={2} />
            <text
              x={pos.x}
              y={pos.y - 6}
              textAnchor="middle"
              fontSize="22"
              fontWeight="700"
              fill="#2563EB"
            >
              {p.label}
            </text>
            <text
              x={pos.x}
              y={pos.y + 18}
              textAnchor="middle"
              fontSize="11"
              fontWeight="700"
              fill="#374151"
            >
              SRI {sriMap[id].toFixed(1)}
            </text>
          </g>
        );
      })}

      <g>
        <circle
          cx={NODE_POSITIONS.EXIT.x}
          cy={NODE_POSITIONS.EXIT.y}
          r={58}
          fill="rgba(239,246,255,0.92)"
          stroke="#2563EB"
          strokeWidth={2}
        />
        <text
          x={NODE_POSITIONS.EXIT.x}
          y={NODE_POSITIONS.EXIT.y + 8}
          textAnchor="middle"
          fontSize="24"
          fontWeight="800"
          fill="#2563EB"
        >
          EXIT
        </text>
      </g>
    </svg>
  );
}

const styles: Record<string, React.CSSProperties> = {
  graphSvg: {
    display: "block",
  },
};