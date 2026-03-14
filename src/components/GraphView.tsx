import React, { useMemo } from "react";
import { NODE_POSITIONS, type Edge, type PointData, type PointNodeId, type SriBand } from "../sim/shared";

const styles: Record<string, React.CSSProperties> = {
  graphSvg: {
    width: "100%",
    maxHeight: 620,
    display: "block",
    background: "#F4F1E8",
  },
};

export default function GraphView(props: {
  edges: Edge[];
  pathEdgeKeys: Set<string>;
  points: PointData[];
  sriMap: Record<PointNodeId, number>;
  bandMap: Record<PointNodeId, SriBand>;
}) {
  const { edges, pathEdgeKeys, points, sriMap, bandMap } = props;

  const pointMap = useMemo(
    () =>
      points.reduce((acc, p) => {
        acc[p.id] = p;
        return acc;
      }, {} as Record<PointNodeId, PointData>),
    [points]
  );

  return (
    <svg viewBox="0 0 480 560" style={styles.graphSvg}>
      <defs>
        <pattern id="grid" width="26" height="26" patternUnits="userSpaceOnUse">
          <path d="M 26 0 L 0 0 0 26" fill="none" stroke="#D1D5DB" strokeWidth="1" />
        </pattern>
      </defs>

      <rect x="0" y="0" width="480" height="560" fill="#F4F1E8" />
      <rect x="0" y="0" width="480" height="560" fill="url(#grid)" />

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

      {(["P1", "P2", "P3", "P4"] as const).map((id) => {
        const pos = NODE_POSITIONS[id];
        const p = pointMap[id];
        const band = bandMap[id];

        const fill =
          band === "high"
            ? "rgba(239,68,68,0.10)"
            : band === "mid"
            ? "rgba(245,158,11,0.10)"
            : "rgba(16,185,129,0.10)";

        return (
          <g key={id}>
            <circle cx={pos.x} cy={pos.y} r={52} fill={fill} />
            <text x={pos.x} y={pos.y - 6} textAnchor="middle" fontSize="22" fontWeight="700" fill="#2563EB">
              {p.label}
            </text>
            <text x={pos.x} y={pos.y + 18} textAnchor="middle" fontSize="11" fontWeight="700" fill="#374151">
              SRI {sriMap[id].toFixed(1)}
            </text>
          </g>
        );
      })}

      <g>
        <circle cx={NODE_POSITIONS.EXIT.x} cy={NODE_POSITIONS.EXIT.y} r={58} fill="#EFF6FF" stroke="#2563EB" strokeWidth={2} />
        <text x={NODE_POSITIONS.EXIT.x} y={NODE_POSITIONS.EXIT.y + 8} textAnchor="middle" fontSize="24" fontWeight="800" fill="#2563EB">
          EXIT
        </text>
      </g>
    </svg>
  );
}