import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import GraphView from "../components/GraphView";
import {
  computeSRI,
  EDGES_DEFAULT,
  getPathEdgeKeys,
  makeInitialPoints,
  sriBand,
  type PointData,
  type PointNodeId,
} from "../sim/shared";

export default function GraphPage() {
  const [points] = useState<PointData[]>(makeInitialPoints());
  const escapePath = ["P4", "EXIT"] as const;

  const metricsMap = useMemo(() => {
    const map: Record<PointNodeId, ReturnType<typeof computeSRI>> = {
      P1: computeSRI(points[0]),
      P2: computeSRI(points[1]),
      P3: computeSRI(points[2]),
      P4: computeSRI(points[3]),
    };
    return map;
  }, [points]);

  const sriMap = useMemo(
    () => ({
      P1: metricsMap.P1.SRI,
      P2: metricsMap.P2.SRI,
      P3: metricsMap.P3.SRI,
      P4: metricsMap.P4.SRI,
    }),
    [metricsMap]
  );

  const bandMap = useMemo(
    () =>
      points.reduce((acc, p) => {
        acc[p.id] = sriBand(sriMap[p.id], p.limitSRI);
        return acc;
      }, {} as Record<PointNodeId, "low" | "mid" | "high">),
    [points, sriMap]
  );

  const pathEdgeKeys = useMemo(() => getPathEdgeKeys([...escapePath]), []);

  return (
    <div style={{ padding: 16 }}>
      <div style={{ marginBottom: 12 }}>
        <Link to="/sinkhole">패널 페이지로 돌아가기</Link>
      </div>

      <GraphView
        edges={EDGES_DEFAULT}
        pathEdgeKeys={pathEdgeKeys}
        points={points}
        sriMap={sriMap}
        bandMap={bandMap}
      />
    </div>
  );
}