import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  buildAdjacency,
  clamp,
  computeSRI,
  dijkstraWithPriority,
  EDGES_DEFAULT,
  getPathEdgeKeys,
  makeInitialPoints,
  POINT_IDS,
  randomTraffic,
  sriBand,
  type PointData,
  type PointNodeId,
  type SriBand,
  type SriMetrics,
} from "../sim/shared";
import GraphView from "../components/GraphView";

type EvacDot = {
  id: string;
  progress: number;
  speed: number;
  path: (PointNodeId | "EXIT")[];
};

function pointBadgeStyleByBand(band: SriBand): React.CSSProperties {
  switch (band) {
    case "low":
      return {
        background: "rgba(167,243,208,1)",
        color: "#065F46",
        border: "1px solid rgba(16,185,129,0.35)",
      };
    case "mid":
      return {
        background: "rgba(253,230,138,1)",
        color: "#92400E",
        border: "1px solid rgba(245,158,11,0.35)",
      };
    case "high":
      return {
        background: "rgba(252,165,165,1)",
        color: "#991B1B",
        border: "1px solid rgba(239,68,68,0.35)",
      };
  }
}

/**
 * 위험 노드를 중간 경유지에서 제외하고,
 * 1) 위험 노드 미경유
 * 2) 더 짧은 거리
 * 3) 더 안전한 노드
 * 우선순위로 경로를 찾기 위한 weight 계산
 */
function getPriorityWeight(
  edge: any,
  blockedNodes: Set<PointNodeId>,
  sriMap: Record<PointNodeId, number>,
  limitMap: Record<PointNodeId, number>
) {
  const to = edge.to as PointNodeId | "EXIT";

  // 중간 경유 위험 노드는 금지
  if (to !== "EXIT" && blockedNodes.has(to)) {
    return Number.POSITIVE_INFINITY;
  }

  // 기본 거리 우선
  const baseWeight =
    typeof edge.weight === "number"
      ? edge.weight
      : typeof edge.baseWeight === "number"
      ? edge.baseWeight
      : 1;

  // 같은 거리일 때 더 안전한 노드를 선호하도록 아주 작은 penalty 추가
  const safetyPenalty =
    to === "EXIT" ? 0 : (sriMap[to] / Math.max(limitMap[to], 0.0001)) * 0.001;

  return baseWeight + safetyPenalty;
}

export default function EscapeSRIPlannerPage() {
  const [points, setPoints] = useState<PointData[]>(() => makeInitialPoints());
  const [simulationRunning, setSimulationRunning] = useState(false);

  // 막는 모달 대신 비차단형 알림 패널
  const [alertOpen, setAlertOpen] = useState(false);
  const [alertNode, setAlertNode] = useState<PointNodeId | null>(null);

  const [escapePath, setEscapePath] = useState<(PointNodeId | "EXIT")[]>([]);
  const [evacuatedCount, setEvacuatedCount] = useState(0);
  const [lastPathCost, setLastPathCost] = useState<number | null>(null);
  const [evacDots, setEvacDots] = useState<EvacDot[]>([]);

  const adj = useMemo(() => buildAdjacency(EDGES_DEFAULT), []);

  const metricsMap = useMemo(() => {
    const map: Record<PointNodeId, SriMetrics> = {
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

  const limitMap = useMemo(
    () =>
      points.reduce((acc, p) => {
        acc[p.id] = p.limitSRI;
        return acc;
      }, {} as Record<PointNodeId, number>),
    [points]
  );

  const bandMap = useMemo(
    () =>
      points.reduce((acc, p) => {
        acc[p.id] = sriBand(sriMap[p.id], p.limitSRI);
        return acc;
      }, {} as Record<PointNodeId, SriBand>),
    [points, sriMap]
  );

  const prevBandRef = useRef<Record<PointNodeId, SriBand>>({
    P1: "low",
    P2: "low",
    P3: "low",
    P4: "low",
  });

  // 이미 대피 처리된 노드는 다시 자동 대피시키지 않기 위한 latch
  const evacuatedNodesRef = useRef<Set<PointNodeId>>(new Set());

  const pathEdgeKeys = useMemo(() => getPathEdgeKeys(escapePath), [escapePath]);

  const updatePoint = (index: number, patch: Partial<PointData>) => {
    setPoints((prev) => {
      const next = [...prev];
      const current = next[index];
      const updated = { ...current, ...patch };
      next[index] = updated;

      // 사용자가 직접 사람 수를 다시 넣어주면 재대피 가능 상태로 해제
      if (typeof patch.peopleCount === "number" && patch.peopleCount > 0) {
        evacuatedNodesRef.current.delete(updated.id);
      }

      return next;
    });
  };

  // 시뮬레이션 시작 상태에서만 교통량 하중만 랜덤 변동
  // (사람 수 및 다른 값들은 자동으로 바뀌지 않음)
  useEffect(() => {
    if (!simulationRunning) return;

    const timer = window.setInterval(() => {
      setPoints((prev) =>
        prev.map((p) => ({
          ...p,
          trafficLoad: randomTraffic(),
        }))
      );
    }, 5000);

    return () => window.clearInterval(timer);
  }, [simulationRunning]);

  // 시뮬레이션 시작 시에만 위험 감지 / 대피 실행
  useEffect(() => {
    if (!simulationRunning) return;

    const prevBand = prevBandRef.current;

    const enteredHigh = POINT_IDS.find((id) => {
      const point = points.find((p) => p.id === id);
      const people = point?.peopleCount ?? 0;

      return (
        prevBand[id] !== "high" &&
        bandMap[id] === "high" &&
        people > 0 &&
        !evacuatedNodesRef.current.has(id)
      );
    });

    prevBandRef.current = bandMap;

    if (!enteredHigh) return;

    // 현재 위험 노드들 중, 시작 노드를 제외한 위험 노드는 경유 금지
    const blockedNodes = new Set<PointNodeId>(
      POINT_IDS.filter((id) => id !== enteredHigh && bandMap[id] === "high")
    );

    const plan = dijkstraWithPriority(
      enteredHigh,
      "EXIT",
      adj,
      blockedNodes,
      sriMap,
      limitMap
    );

    // 잘못된 fallback([enteredHigh, "EXIT"]) 제거
    // dijkstra가 찾은 경로만 사용
    const finalPath = plan?.path ?? [];

    const targetPoint = points.find((p) => p.id === enteredHigh);
    const people = targetPoint?.peopleCount ?? 0;

    setAlertNode(enteredHigh);
    setAlertOpen(true);

    if (people <= 0 || finalPath.length === 0) {
      setEscapePath([]);
      setLastPathCost(null);
      setEvacuatedCount(0);
      setEvacDots([]);
      return;
    }

    setEscapePath(finalPath);
    setLastPathCost(plan?.cost ?? null);
    setEvacuatedCount(people);

    // 해당 위험 노드는 한 번 대피 처리되면 자동 재대피 방지
    evacuatedNodesRef.current.add(enteredHigh);

    // 대피 후 출발 위험 노드 인원만 차감
    // 중간 경유 노드에는 사람 수를 더하지 않음
    setPoints((prev) =>
      prev.map((p) =>
        p.id === enteredHigh
          ? {
              ...p,
              peopleCount: 0,
            }
          : p
      )
    );

    const dotCount = Math.min(12, Math.max(4, Math.floor(Math.max(people, 1) / 2)));

    setEvacDots(
      Array.from({ length: dotCount }).map((_, i) => ({
        id: `${enteredHigh}-${Date.now()}-${i}`,
        progress: Math.random() * 0.05,
        speed: 0.0025 + Math.random() * 0.0035,
        path: finalPath,
      }))
    );
  }, [simulationRunning, bandMap, adj, sriMap, limitMap, points]);

  // 시뮬레이션 시작 상태에서만 점 이동
  useEffect(() => {
    if (!simulationRunning) return;
    if (evacDots.length === 0) return;

    let frameId = 0;

    const tick = () => {
      setEvacDots((prev) =>
        prev
          .map((dot) => ({
            ...dot,
            progress: Math.min(1, dot.progress + dot.speed),
          }))
          .filter((dot) => dot.progress < 1)
      );

      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(frameId);
  }, [simulationRunning, evacDots.length]);

  const resetAll = () => {
    setPoints(makeInitialPoints());
    setSimulationRunning(false);
    setAlertOpen(false);
    setAlertNode(null);
    setEscapePath([]);
    setEvacuatedCount(0);
    setLastPathCost(null);
    setEvacDots([]);
    prevBandRef.current = {
      P1: "low",
      P2: "low",
      P3: "low",
      P4: "low",
    };
    evacuatedNodesRef.current = new Set();
  };

  return (
    <div style={styles.page}>
      <div style={styles.headerRow}>
        <div>
          <h2 style={styles.title}>위험 노드 발생 시 EXIT 대피 시뮬레이션</h2>
          <p style={styles.subTitle}>
            시뮬레이션 시작 버튼을 눌러야 감지/대피/애니메이션이 실행되며,
            위험 노드는 중간 경유지로 선택되지 않습니다.
          </p>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <div style={styles.currentPill}>
            시뮬레이션:
            <strong style={{ marginLeft: 6, color: simulationRunning ? "#065F46" : "#374151" }}>
              {simulationRunning ? "실행 중" : "정지"}
            </strong>
          </div>

          <button
            type="button"
            style={{
              ...styles.resetBtn,
              background: simulationRunning ? "#111827" : "#FAFAFA",
              color: simulationRunning ? "#FFFFFF" : "#111827",
              borderColor: simulationRunning ? "#111827" : "#E5E7EB",
            }}
            onClick={() => setSimulationRunning((v) => !v)}
          >
            {simulationRunning ? "시뮬레이션 일시정지" : "시뮬레이션 시작"}
          </button>

          <button type="button" style={styles.resetBtn} onClick={resetAll}>
            초기화
          </button>
        </div>
      </div>

      <section style={styles.graphCard}>
        <div style={styles.graphTitle}>그래프 미리보기</div>

        <div style={styles.graphWrapper}>
          <img src="map.png" alt="map" style={styles.mapBackground} />

          <GraphView
            edges={EDGES_DEFAULT}
            pathEdgeKeys={pathEdgeKeys}
            points={points}
            sriMap={sriMap}
            bandMap={bandMap}
            evacDots={evacDots}
          />
        </div>
      </section>

      <div style={styles.grid}>
        {points.map((p, idx) => {
          const m = metricsMap[p.id];
          const band = sriBand(m.SRI, p.limitSRI);
          const isDanger = m.SRI >= p.limitSRI;

          return (
            <section key={p.id} style={styles.card}>
              <div style={styles.cardHeader}>
                <div style={{ ...styles.pointBadge, ...pointBadgeStyleByBand(band) }}>{p.label}</div>

                <div style={styles.cardMeta}>
                  <div style={styles.metaLine}>
                    인원: <strong>{p.peopleCount}명</strong> / 교통량: <strong>{p.trafficLoad}</strong>
                  </div>
                  <div style={styles.metaLine}>
                    굴착:
                    <strong style={{ color: p.excavation ? "#B7202A" : "#1F2937", marginLeft: 4 }}>
                      {p.excavation ? "유" : "무"}
                    </strong>
                    <span style={{ marginLeft: 8 }}>누수:</span>
                    <strong style={{ marginLeft: 4 }}>{p.hoseLeak}</strong>
                  </div>
                </div>

                <div style={{ marginLeft: "auto", textAlign: "right" }}>
                  <div style={styles.sriLabel}>real SRI / limit</div>
                  <div style={styles.sriValue}>
                    {m.SRI.toFixed(2)} / {p.limitSRI.toFixed(1)}
                  </div>
                </div>
              </div>

              <div style={styles.statusRow}>
                <span
                  style={{
                    ...styles.statusPill,
                    ...(isDanger ? styles.statusDanger : styles.statusSafe),
                  }}
                >
                  {isDanger ? "위험 노드" : "정상 노드"}
                </span>
              </div>

              <div style={styles.formGrid}>
                <NumberField
                  label="한계 SRI"
                  value={p.limitSRI}
                  onChange={(v) => updatePoint(idx, { limitSRI: clamp(v, 1, 10) })}
                  min={1}
                  max={10}
                  step={0.1}
                />
                <NumberField
                  label="강우량"
                  value={p.rainfall}
                  onChange={(v) => updatePoint(idx, { rainfall: v })}
                  min={0}
                />
                <NumberField
                  label="흙"
                  value={p.soil}
                  onChange={(v) => updatePoint(idx, { soil: v })}
                  min={0}
                />
              </div>

              <div style={styles.formGrid}>
                <NumberField
                  label="모래"
                  value={p.sand}
                  onChange={(v) => updatePoint(idx, { sand: v })}
                  min={0}
                />
                <NumberField
                  label="사람 수"
                  value={p.peopleCount}
                  onChange={(v) => updatePoint(idx, { peopleCount: clamp(v, 0, 100) })}
                  min={0}
                  max={100}
                />
                <div />
              </div>

              <div style={styles.controls}>
                <SliderField
                  label="호스 누수 단계형"
                  value={p.hoseLeak}
                  min={0}
                  max={3}
                  step={1}
                  marks={[0, 1, 2, 3]}
                  onChange={(v) => updatePoint(idx, { hoseLeak: v as 0 | 1 | 2 | 3 })}
                />

                <ToggleField
                  label="굴착 유무"
                  checked={p.excavation}
                  onChange={(checked) => updatePoint(idx, { excavation: checked })}
                />

                <SliderField
                  label="교통량 하중"
                  value={p.trafficLoad}
                  min={0}
                  max={2}
                  step={1}
                  marks={[0, 1, 2]}
                  onChange={(v) => updatePoint(idx, { trafficLoad: v as 0 | 1 | 2 })}
                />
              </div>
            </section>
          );
        })}
      </div>

      {alertOpen && alertNode && (
        <div style={styles.toastPanel}>
          <div style={styles.toastHeader}>
            <div style={styles.toastTitle}>⚠️ 위험 노드 발생: {alertNode}</div>
            <button
              type="button"
              style={styles.toastClose}
              onClick={() => setAlertOpen(false)}
              aria-label="close"
            >
              ✕
            </button>
          </div>

          <div style={styles.toastBody}>
            <div style={styles.modalMsg}>
              {escapePath.length > 0 ? (
                <>
                  <strong>{alertNode}</strong>의 실시간 SRI가 한계 SRI를 초과했습니다.
                  현재 해당 지역의 <strong>{evacuatedCount}명</strong>이 <strong>EXIT</strong>로
                  이동 중입니다.
                </>
              ) : (
                <>
                  <strong>{alertNode}</strong>의 실시간 SRI가 한계 SRI를 초과했지만,
                  현재 조건으로는 EXIT 경로를 찾지 못했습니다.
                </>
              )}
            </div>

            {escapePath.length > 0 && (
              <div style={styles.pathBox}>
                <div style={styles.pathLabel}>대피 경로</div>
                <div style={styles.pathLine}>
                  {escapePath.map((n, i) => (
                    <span key={`${n}-${i}`}>
                      <span style={{ ...styles.pathNode, ...(n === "EXIT" ? styles.exitNode : {}) }}>
                        {n}
                      </span>
                      {i < escapePath.length - 1 && <span style={styles.pathArrow}>→</span>}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {lastPathCost !== null && escapePath.length > 0 && (
              <div style={styles.modalMsgSmall}>
                계산 비용: <strong>{lastPathCost.toFixed(2)}</strong>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- UI Components ---------------- */

function NumberField(props: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  const { label, value, onChange, min, max, step } = props;
  const [inputValue, setInputValue] = React.useState<string>(String(value));

  React.useEffect(() => setInputValue(String(value)), [value]);

  return (
    <label style={styles.field}>
      <div style={styles.labelRow}>
        <span style={styles.label}>{label}</span>
      </div>
      <input
        type="number"
        style={styles.input}
        value={inputValue}
        min={min}
        max={max}
        step={step ?? 1}
        onChange={(e) => {
          const raw = e.target.value;
          setInputValue(raw);
          if (raw === "") return;

          const n = Number(raw);
          if (!Number.isFinite(n)) return;

          const clamped =
            typeof min === "number" || typeof max === "number"
              ? clamp(n, min ?? -Infinity, max ?? Infinity)
              : n;

          onChange(clamped);
        }}
        onBlur={() => {
          if (inputValue === "") {
            setInputValue("0");
            onChange(0);
          }
        }}
      />
    </label>
  );
}

function SliderField(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  marks: number[];
  onChange: (v: number) => void;
}) {
  const { label, value, min, max, step, marks, onChange } = props;

  return (
    <div style={styles.field}>
      <div style={styles.labelRow}>
        <span style={styles.label}>{label}</span>
        <span style={styles.valuePill}>{value}</span>
      </div>

      <input
        type="range"
        style={styles.slider}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />

      <div style={styles.marks}>
        {marks.map((m) => (
          <span key={m} style={styles.mark}>
            {m}
          </span>
        ))}
      </div>
    </div>
  );
}

function ToggleField(props: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const { label, checked, onChange } = props;

  return (
    <div style={styles.field}>
      <div style={styles.labelRow}>
        <span style={styles.label}>{label}</span>
        <span style={styles.valuePill}>{checked ? "ON" : "OFF"}</span>
      </div>

      <button
        type="button"
        style={{
          ...styles.toggle,
          background: checked ? "rgba(183, 32, 42, 0.12)" : "#F3F4F6",
          borderColor: checked ? "rgba(183, 32, 42, 0.35)" : "#E5E7EB",
        }}
        onClick={() => onChange(!checked)}
        aria-pressed={checked}
      >
        <span
          style={{
            ...styles.toggleKnob,
            transform: checked ? "translateX(26px)" : "translateX(0px)",
            background: checked ? "#B7202A" : "#9CA3AF",
          }}
        />
      </button>
    </div>
  );
}

/* ---------------- Styles ---------------- */

const styles: Record<string, React.CSSProperties> = {
  page: {
    padding: 16,
    fontFamily:
      'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif',
    color: "#111827",
    background: "#FFFFFF",
  },
  headerRow: {
    display: "flex",
    gap: 12,
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 16,
    flexWrap: "wrap",
  },
  title: { margin: 0, fontSize: 20, fontWeight: 700 },
  subTitle: { margin: "6px 0 0", fontSize: 13, color: "#6B7280", lineHeight: 1.5 },

  resetBtn: {
    padding: "8px 10px",
    borderRadius: 8,
    border: "1px solid #E5E7EB",
    background: "#FAFAFA",
    cursor: "pointer",
    fontSize: 13,
  },
  currentPill: {
    padding: "8px 10px",
    borderRadius: 8,
    border: "1px solid #E5E7EB",
    background: "#FFFFFF",
    fontSize: 13,
  },

  graphCard: {
    border: "1px solid #E5E7EB",
    borderRadius: 14,
    overflow: "hidden",
    marginBottom: 16,
    background: "#FFFFFF",
  },
  graphTitle: {
    padding: "10px 12px",
    fontSize: 13,
    fontWeight: 800,
    borderBottom: "1px solid #E5E7EB",
    background: "#F9FAFB",
  },
  graphWrapper: {
    position: "relative",
    width: "100%",
    height: 520,
    overflow: "hidden",
  },
  mapBackground: {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    objectFit: "cover",
    zIndex: 0,
  },

  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: 12,
  },
  card: {
    border: "1px solid #E5E7EB",
    borderRadius: 12,
    padding: 12,
    boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
  },
  cardHeader: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 10,
  },
  pointBadge: {
    minWidth: 42,
    height: 32,
    borderRadius: 10,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 800,
    fontSize: 13,
  },
  cardMeta: { display: "flex", flexDirection: "column", gap: 2, fontSize: 12, color: "#374151" },
  metaLine: { lineHeight: 1.4 },

  sriLabel: { fontSize: 11, color: "#6B7280", fontWeight: 800 },
  sriValue: { fontSize: 18, fontWeight: 900 },

  statusRow: { marginBottom: 10 },
  statusPill: {
    display: "inline-flex",
    alignItems: "center",
    padding: "4px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 800,
  },
  statusSafe: {
    color: "#065F46",
    background: "rgba(16, 185, 129, 0.12)",
    border: "1px solid rgba(16, 185, 129, 0.28)",
  },
  statusDanger: {
    color: "#991B1B",
    background: "rgba(239, 68, 68, 0.12)",
    border: "1px solid rgba(239, 68, 68, 0.28)",
  },

  formGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: 10,
    marginBottom: 10,
  },
  controls: { display: "grid", gap: 10 },

  field: { display: "grid", gap: 6 },
  labelRow: { display: "flex", alignItems: "center", justifyContent: "space-between" },
  label: { fontSize: 12, color: "#374151", fontWeight: 600 },

  input: {
    width: "100%",
    padding: "8px 10px",
    border: "1px solid #E0E0E0",
    borderRadius: 6,
    fontSize: 14,
    background: "#FAFAFA",
    color: "var(--text-main, #111827)",
    outline: "none",
    boxSizing: "border-box",
  },

  slider: { width: "100%" },
  marks: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: 11,
    color: "#6B7280",
    marginTop: -2,
  },
  mark: { userSelect: "none" },

  valuePill: {
    fontSize: 12,
    padding: "2px 8px",
    borderRadius: 999,
    border: "1px solid #E5E7EB",
    background: "#FAFAFA",
    color: "#111827",
  },

  toggle: {
    width: 56,
    height: 30,
    borderRadius: 999,
    border: "1px solid #E5E7EB",
    background: "#F3F4F6",
    position: "relative",
    cursor: "pointer",
    padding: 2,
  },
  toggleKnob: {
    width: 26,
    height: 26,
    borderRadius: 999,
    display: "block",
    transition: "transform 180ms ease",
  },

  toastPanel: {
    position: "fixed",
    right: 16,
    bottom: 16,
    width: "min(420px, calc(100vw - 32px))",
    background: "#FFFFFF",
    border: "1px solid #E5E7EB",
    borderRadius: 14,
    boxShadow: "0 10px 30px rgba(0,0,0,0.15)",
    overflow: "hidden",
    zIndex: 50,
  },
  toastHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 14px",
    borderBottom: "1px solid #E5E7EB",
    background: "#FFF7ED",
  },
  toastTitle: { fontSize: 14, fontWeight: 900 },
  toastClose: {
    border: "1px solid #E5E7EB",
    background: "#FFFFFF",
    borderRadius: 10,
    color: "#6B7280",
    width: 32,
    height: 32,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },

  modalMsg: { fontSize: 14, lineHeight: 1.6 },
  modalMsgSmall: { fontSize: 12, lineHeight: 1.5, color: "#6B7280" },
  toastBody: { padding: 14, display: "grid", gap: 12 },

  pathBox: {
    border: "1px solid #E5E7EB",
    borderRadius: 12,
    padding: 12,
    background: "#FAFAFA",
  },
  pathLabel: { fontSize: 12, fontWeight: 800, color: "#374151", marginBottom: 6 },
  pathLine: {
    fontSize: 14,
    fontWeight: 800,
    display: "flex",
    flexWrap: "wrap",
    gap: 4,
    alignItems: "center",
  },
  pathNode: {
    padding: "2px 8px",
    borderRadius: 999,
    border: "1px solid #E5E7EB",
    background: "#FFFFFF",
  },
  exitNode: {
    color: "#065F46",
    background: "#ECFDF5",
    border: "1px solid rgba(16, 185, 129, 0.35)",
  },
  pathArrow: { margin: "0 4px", color: "#6B7280" },
};