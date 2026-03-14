import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  buildAdjacency,
  clamp,
  computeSRI,
  dijkstra,
  edgeRealWeight,
  EDGES_DEFAULT,
  getPathEdgeKeys,
  makeInitialPoints,

  POINT_IDS,
  randomPeople,
  randomTraffic,
  sriBand,
  type PointData,
  type PointNodeId,
  type SriBand,
  type SriMetrics,
} from "../sim/shared";
import GraphView from "../components/GraphView";

function pointBadgeStyleByBand(band: SriBand): React.CSSProperties {
  switch (band) {
    case "low":
      return {
        background: "rgba(16, 185, 129, 0.18)",
        color: "#065F46",
        border: "1px solid rgba(16, 185, 129, 0.35)",
      };
    case "mid":
      return {
        background: "rgba(245, 158, 11, 0.18)",
        color: "#92400E",
        border: "1px solid rgba(245, 158, 11, 0.35)",
      };
    case "high":
      return {
        background: "rgba(239, 68, 68, 0.18)",
        color: "#991B1B",
        border: "1px solid rgba(239, 68, 68, 0.35)",
      };
  }
}

export default function EscapeSRIPlannerPage() {
  const [points, setPoints] = useState<PointData[]>(() => makeInitialPoints());
  const [simulationRunning, setSimulationRunning] = useState(false);

  const [alertOpen, setAlertOpen] = useState(false);
  const [alertNode, setAlertNode] = useState<PointNodeId | null>(null);

  const [escapePath, setEscapePath] = useState<(PointNodeId | "EXIT")[]>([]);
  const [evacuatedCount, setEvacuatedCount] = useState(0);
  const [lastPathCost, setLastPathCost] = useState<number | null>(null);

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

  const pathEdgeKeys = useMemo(() => getPathEdgeKeys(escapePath), [escapePath]);

  const updatePoint = (index: number, patch: Partial<PointData>) => {
    setPoints((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], ...patch };
      return next;
    });
  };

  useEffect(() => {
    if (!simulationRunning) return;

    const timer = window.setInterval(() => {
      setPoints((prev) =>
        prev.map((p) => ({
          ...p,
          trafficLoad: randomTraffic(),
          peopleCount: randomPeople(p.peopleCount),
        }))
      );
    }, 5000);

    return () => window.clearInterval(timer);
  }, [simulationRunning]);

  useEffect(() => {
    const prevBand = prevBandRef.current;

    const enteredHigh = POINT_IDS.find((id) => prevBand[id] !== "high" && bandMap[id] === "high");

    prevBandRef.current = bandMap;

    if (!enteredHigh) return;

    const plan = dijkstra(enteredHigh, "EXIT", adj, (edge) =>
      edgeRealWeight(edge, sriMap, limitMap).realWeight
    );

    setAlertNode(enteredHigh);
    setAlertOpen(true);
    setEscapePath(plan?.path ?? [enteredHigh]);
    setLastPathCost(plan?.cost ?? null);

    const targetPoint = points.find((p) => p.id === enteredHigh);
    setEvacuatedCount(targetPoint?.peopleCount ?? 0);
  }, [bandMap, adj, sriMap, limitMap, points]);

  const resetAll = () => {
    setPoints(makeInitialPoints());
    setSimulationRunning(false);
    setAlertOpen(false);
    setAlertNode(null);
    setEscapePath([]);
    setEvacuatedCount(0);
    setLastPathCost(null);
    prevBandRef.current = {
      P1: "low",
      P2: "low",
      P3: "low",
      P4: "low",
    };
  };

  return (
    <div style={styles.page}>
      <div style={styles.headerRow}>
        <div>
          <h2 style={styles.title}>위험 노드 발생 시 EXIT 대피 시뮬레이션</h2>
          <p style={styles.subTitle}>
            사용자 그래프 구조(1-2-3-4-EXIT)를 반영해, 위험 노드 발생 시 EXIT까지의 real
            가중치 최단경로를 계산합니다.
          </p>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {/* <Link to="/sinkhole/graph" style={styles.linkBtn}>
            그래프 전용 페이지
          </Link> */}

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
        <GraphView
          edges={EDGES_DEFAULT}
          pathEdgeKeys={pathEdgeKeys}
          points={points}
          sriMap={sriMap}
          bandMap={bandMap}
        />
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
        <div style={styles.modalBackdrop} role="dialog" aria-modal="true">
          <div style={styles.modal}>
            <div style={styles.modalTitleRow}>
              <div style={styles.modalTitle}>⚠️ 위험 노드 발생: {alertNode}</div>
              <button
                type="button"
                style={styles.modalClose}
                onClick={() => setAlertOpen(false)}
                aria-label="close"
              >
                ✕
              </button>
            </div>

            <div style={styles.modalBody}>
              <div style={styles.modalMsg}>
                <strong>{alertNode}</strong>의 실시간 SRI가 한계 SRI를 초과했습니다.
                현재 해당 지역의 <strong>{evacuatedCount}명</strong>을 <strong>EXIT</strong>로
                이동시켜야 합니다.
              </div>

              <div style={styles.pathBox}>
                <div style={styles.pathLabel}>대피 경로 (EXIT까지 real 가중치 최단 경로)</div>
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

              {lastPathCost !== null && (
                <div style={styles.modalMsgSmall}>
                  계산된 real 최단 비용: <strong>{lastPathCost.toFixed(2)}</strong>
                </div>
              )}

              <div style={styles.modalMsgSmall}>
                EXIT는 위험도 영향을 받지 않는 도착 목적지입니다.
              </div>
            </div>
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

  linkBtn: {
    padding: "8px 10px",
    borderRadius: 8,
    border: "1px solid #E5E7EB",
    background: "#FFFFFF",
    color: "#111827",
    textDecoration: "none",
    fontSize: 13,
    fontWeight: 600,
  },

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

  modalBackdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.35)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    zIndex: 50,
  },
  modal: {
    width: "min(640px, 100%)",
    background: "#FFFFFF",
    borderRadius: 14,
    border: "1px solid #E5E7EB",
    boxShadow: "0 10px 30px rgba(0,0,0,0.15)",
    overflow: "hidden",
  },
  modalTitleRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 14px",
    borderBottom: "1px solid #E5E7EB",
    background: "#FFF7ED",
  },
  modalTitle: { fontSize: 14, fontWeight: 900 },
  modalClose: {
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
  modalBody: { padding: 14, display: "grid", gap: 12 },
  modalMsg: { fontSize: 14, lineHeight: 1.6 },
  modalMsgSmall: { fontSize: 12, lineHeight: 1.5, color: "#6B7280" },

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