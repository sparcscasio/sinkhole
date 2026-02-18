import React, { useEffect, useMemo, useRef, useState } from "react";

/** ---------------- Types ---------------- */

type HoseLeakLevel = 0 | 1 | 2 | 3;
type TrafficLoadLevel = 0 | 1 | 2;

type NodeId = "P1" | "P2" | "P3" | "P4";

type PointData = {
  id: NodeId;
  rainfall: number; // 강우량
  soil: number; // 흙
  sand: number; // 모래
  hoseLeak: HoseLeakLevel; // 0~3
  excavation: boolean; // 굴착 유무
  trafficLoad: TrafficLoadLevel; // 0~2
};

type SriBand = "low" | "mid" | "high";

type SriMetrics = {
  R: number;
  f: number;
  T: number;
  L: number;
  E: number;
  D: number;
  raw: number;
  SRI: number;
};

type Edge = {
  a: NodeId;
  b: NodeId;
  distance: number; // const distance (= default weight)
};

/** ---------------- Constants ---------------- */

// 한계 SRI(>=7이면 high + 경보)
const LIMIT_SRI = 7;

// 누수/하중 매핑
const L_MAP: Record<HoseLeakLevel, number> = { 0: 0, 1: 0.3, 2: 0.6, 3: 1 };
const D_MAP: Record<TrafficLoadLevel, number> = { 0: 0, 1: 0.5, 2: 1 };

// 거리(= default 가중치) const
// ✅ 여기만 고치면 “두 지역 사이 거리” 바뀜
const EDGES_DEFAULT: Edge[] = [
  { a: "P1", b: "P2", distance: 6 },
  { a: "P2", b: "P3", distance: 5 },
  { a: "P3", b: "P4", distance: 7 },
  { a: "P1", b: "P3", distance: 9 },
  { a: "P2", b: "P4", distance: 8 },
];

/** ---------------- Helpers ---------------- */

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const clip01 = (v: number) => clamp(v, 0, 1);

function sriBand(sri: number): SriBand {
  if (sri <= 3) return "low";
  if (sri < 7) return "mid";
  return "high"; // 7~10
}

function makeInitialPoints(): PointData[] {
  return (["P1", "P2", "P3", "P4"] as const).map((id) => ({
    id,
    rainfall: 0,
    soil: 0,
    sand: 0,
    hoseLeak: 0,
    excavation: false,
    trafficLoad: 0,
  }));
}

/** ---- SRI 계산 ---- */
function computeSRI(p: PointData): SriMetrics {
  const R = Math.min(p.rainfall / 1000, 1);

  const denom = p.soil + p.sand;
  const f = denom > 0 ? p.soil / denom : 0;

  const T = clip01((f - 0.25) / 0.5);

  const L = L_MAP[p.hoseLeak];
  const E = p.excavation ? 1 : 0;
  const D = D_MAP[p.trafficLoad];

  const raw = 3 * R + 3 * T + 2 * L + 1 * E + 1 * D;
  const SRI = Math.min(10, raw);

  return { R, f, T, L, E, D, raw, SRI };
}

function nodeFactorBySri(sri: number): number {
  const margin = LIMIT_SRI - sri;

  if (margin <= 0) return 5.0; // 위험 회피

  const ratio = clip01(margin / LIMIT_SRI); // 0..1
  return 1 - 0.6 * ratio; // 1.0 .. 0.4
}

function edgeRealWeight(edge: Edge, sriMap: Record<NodeId, number>) {
  const dw = edge.distance;
  const fa = nodeFactorBySri(sriMap[edge.a]);
  const fb = nodeFactorBySri(sriMap[edge.b]);
  const edgeFactor = (fa + fb) / 2;
  return { defaultWeight: dw, realWeight: dw * edgeFactor };
}

/** ---- Graph + Dijkstra ---- */

function buildAdjacency(edges: Edge[]) {
  const adj: Record<NodeId, Array<{ to: NodeId; edge: Edge }>> = {
    P1: [],
    P2: [],
    P3: [],
    P4: [],
  };
  for (const e of edges) {
    adj[e.a].push({ to: e.b, edge: e });
    adj[e.b].push({ to: e.a, edge: e });
  }
  return adj;
}

type PathResult = { path: NodeId[]; cost: number } | null;

function dijkstra(
  start: NodeId,
  targets: Set<NodeId>,
  adj: Record<NodeId, Array<{ to: NodeId; edge: Edge }>>,
  weightFn: (edge: Edge) => number
): PathResult {
  const nodes: NodeId[] = ["P1", "P2", "P3", "P4"];
  const dist: Record<NodeId, number> = { P1: Infinity, P2: Infinity, P3: Infinity, P4: Infinity };
  const prev: Partial<Record<NodeId, NodeId>> = {};
  const visited = new Set<NodeId>();
  dist[start] = 0;

  while (visited.size < nodes.length) {
    let u: NodeId | null = null;
    let best = Infinity;
    for (const n of nodes) {
      if (!visited.has(n) && dist[n] < best) {
        best = dist[n];
        u = n;
      }
    }
    if (u === null || best === Infinity) break;

    visited.add(u);

    if (targets.has(u)) {
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
      const w = weightFn(edge);
      const alt = dist[u] + w;
      if (alt < dist[to]) {
        dist[to] = alt;
        prev[to] = u;
      }
    }
  }
  return null;
}

/** ---- 목적지 선택: “안전 후보들(SRI < LIMIT)” 중 최단(real) 경로 ----
 *  - start는 high로 올라간 노드
 *  - targets: start 제외, SRI < LIMIT 인 노드
 *  - 후보가 없으면: start 제외 모든 노드(그래도 경로는 계산)
 */
function computeEscapePlan(params: {
  start: NodeId;
  sriMap: Record<NodeId, number>;
  adj: Record<NodeId, Array<{ to: NodeId; edge: Edge }>>;
}) {
  const { start, sriMap, adj } = params;

  const safeCandidates = (["P1", "P2", "P3", "P4"] as const).filter(
    (n) => n !== start && sriMap[n] < LIMIT_SRI
  );

  const targets =
    safeCandidates.length > 0
      ? new Set<NodeId>(safeCandidates)
      : new Set<NodeId>((["P1", "P2", "P3", "P4"] as const).filter((n) => n !== start));

  const weightFn = (e: Edge) => edgeRealWeight(e, sriMap).realWeight;

  // Dijkstra는 “targets 중 가장 먼저 도달한 최단”을 반환하므로,
  // 여러 목적지에 대해 전부 비교하려면 “목표별”로 돌리거나,
  // 여기서는 간단히: 목표 집합을 넣고 하나 나오면 그게 최단(집합 내).
  // => OK (집합 내 최단 목적지)
  const best = dijkstra(start, targets, adj, weightFn);

  if (!best) return null;

  const destination = best.path[best.path.length - 1];
  return { ...best, destination };
}

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


export default function EscapeSRIPlanner() {
  const [points, setPoints] = useState<PointData[]>(() => makeInitialPoints());

  // “현재 사용자가 위치한 노드” (팝업에서 다음 노드로 이동 버튼 클릭 시 갱신)
  const [currentNode, setCurrentNode] = useState<NodeId>("P1");

  // 경보 팝업 상태
  const [alertOpen, setAlertOpen] = useState(false);
  const [alertFrom, setAlertFrom] = useState<NodeId | null>(null);

  // 탈출 계획(경로)
  const [escapePath, setEscapePath] = useState<NodeId[]>([]);
  const [escapeDest, setEscapeDest] = useState<NodeId | null>(null);

  const updatePoint = (index: number, patch: Partial<PointData>) => {
    setPoints((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], ...patch };
      return next;
    });
  };

  const adj = useMemo(() => buildAdjacency(EDGES_DEFAULT), []);

  // SRI map
  const sriMap = useMemo(() => {
    const map: Record<NodeId, number> = { P1: 0, P2: 0, P3: 0, P4: 0 };
    for (const p of points) {
      map[p.id] = computeSRI(p).SRI;
    }
    return map;
  }, [points]);

  // “high로 올라가는 순간” 감지를 위한 이전 band 저장
  const prevBandRef = useRef<Record<NodeId, SriBand>>({ P1: "low", P2: "low", P3: "low", P4: "low" });

  // 실시간 감시: 어떤 노드가 high로 “처음 진입”하면 alert + 경로 계산
  useEffect(() => {
    const nowBand: Record<NodeId, SriBand> = {
      P1: sriBand(sriMap.P1),
      P2: sriBand(sriMap.P2),
      P3: sriBand(sriMap.P3),
      P4: sriBand(sriMap.P4),
    };

    const prevBand = prevBandRef.current;

    // high로 새로 들어간 노드 찾기(여러 개면 첫 번째)
    const enteredHigh = (["P1", "P2", "P3", "P4"] as const).find(
      (n) => prevBand[n] !== "high" && nowBand[n] === "high"
    );

    // prev 업데이트
    prevBandRef.current = nowBand;

    if (!enteredHigh) return;

    // 경보 시작
    setAlertOpen(true);
    setAlertFrom(enteredHigh);

    // 탈출 경로: “enteredHigh 지역”에서 “안전 후보 지역”으로
    const plan = computeEscapePlan({
      start: enteredHigh,
      sriMap,
      adj,
    });

    if (plan) {
      setEscapePath(plan.path);
      setEscapeDest(plan.destination);
    } else {
      setEscapePath([enteredHigh]);
      setEscapeDest(null);
    }
  }, [sriMap, adj]);

  // 팝업 “다음 노드로 이동”
  const nextHop = useMemo(() => {
    if (!escapePath || escapePath.length < 2) return null;
    // 현재 위치가 경로 상 어딘지 찾고 그 다음 노드
    const idx = escapePath.indexOf(currentNode);
    if (idx >= 0 && idx < escapePath.length - 1) return escapePath[idx + 1];
    // 현재 위치가 경로에 없으면 시작점(경보 지역) 다음
    return escapePath[1];
  }, [escapePath, currentNode]);

  return (
    <div style={styles.page}>
      <div style={styles.headerRow}>
        <div>
          <h2 style={styles.title}>SRI 경보 + P1~P4 탈출 경로(최단경로)</h2>
          <p style={styles.subTitle}>
            어떤 점이 high(≥7)로 올라가는 순간 경보 팝업이 뜨고, P1~P4 중 안전 후보로의 최단 경로(real 가중치)를
            보여줍니다.
          </p>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={styles.currentPill}>
            현재 위치: <strong style={{ marginLeft: 6 }}>{currentNode}</strong>
          </div>
          <button type="button" style={styles.resetBtn} onClick={() => setPoints(makeInitialPoints())}>
            초기화
          </button>
        </div>
      </div>

      <div style={styles.grid}>
        {points.map((p, idx) => {
          const m = computeSRI(p);
          const band = sriBand(m.SRI);

          return (
            <section key={p.id} style={styles.card}>
              <div style={styles.cardHeader}>
                <div style={{ ...styles.pointBadge, ...pointBadgeStyleByBand(band) }}>{p.id}</div>

                <div style={styles.cardMeta}>
                  <div style={styles.metaLine}>
                    굴착:{" "}
                    <strong style={{ color: p.excavation ? "#B7202A" : "#1F2937" }}>
                      {p.excavation ? "유" : "무"}
                    </strong>
                  </div>
                  <div style={styles.metaLine}>
                    누수: <strong>{p.hoseLeak}</strong> / 하중: <strong>{p.trafficLoad}</strong>
                  </div>
                </div>

                <div style={{ marginLeft: "auto", textAlign: "right" }}>
                  <div style={styles.sriLabel}>SRI</div>
                  <div style={styles.sriValue}>{m.SRI.toFixed(2)}</div>
                </div>
              </div>

              <div style={styles.formGrid}>
                <NumberField
                  label="강우량"
                  value={p.rainfall}
                  onChange={(v) => updatePoint(idx, { rainfall: v })}
                  min={0}
                />
                <NumberField label="흙" value={p.soil} onChange={(v) => updatePoint(idx, { soil: v })} min={0} />
                <NumberField
                  label="모래"
                  value={p.sand}
                  onChange={(v) => updatePoint(idx, { sand: v })}
                  min={0}
                />
              </div>

              <div style={styles.controls}>
                <SliderField
                  label="호스 누수 단계형"
                  value={p.hoseLeak}
                  min={0}
                  max={3}
                  step={1}
                  marks={[0, 1, 2, 3]}
                  onChange={(v) => updatePoint(idx, { hoseLeak: v as HoseLeakLevel })}
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
                  onChange={(v) => updatePoint(idx, { trafficLoad: v as TrafficLoadLevel })}
                />
              </div>
            </section>
          );
        })}
      </div>

      {/* 경보 팝업 */}
      {alertOpen && alertFrom && (
        <div style={styles.modalBackdrop} role="dialog" aria-modal="true">
          <div style={styles.modal}>
            <div style={styles.modalTitleRow}>
              <div style={styles.modalTitle}>⚠️ 경보: {alertFrom} 지역 위험 상승</div>
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
              {escapeDest ? (
                <>
                  <div style={styles.modalMsg}>
                    <strong>{escapeDest}</strong>로 이동하세요.
                  </div>

                  <div style={styles.pathBox}>
                    <div style={styles.pathLabel}>탈출 경로 (real 가중치 최단)</div>
                    <div style={styles.pathLine}>
                      {escapePath.map((n, i) => (
                        <span key={n}>
                          <span style={styles.pathNode}>{n}</span>
                          {i < escapePath.length - 1 && <span style={styles.pathArrow}>→</span>}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div style={styles.modalControls}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span style={styles.currentSmall}>현재: {currentNode}</span>
                      {nextHop ? <span style={styles.nextSmall}>다음: {nextHop}</span> : null}
                    </div>

                    <button
                      type="button"
                      style={styles.primaryBtn}
                      disabled={!nextHop}
                      onClick={() => {
                        if (!nextHop) return;
                        setCurrentNode(nextHop);

                        // 목적지 도착하면 팝업 닫기
                        if (nextHop === escapeDest) setAlertOpen(false);
                      }}
                    >
                      다음 노드로 이동
                    </button>
                  </div>
                </>
              ) : (
                <div style={styles.modalMsg}>경로를 계산할 수 없습니다(그래프 연결을 확인하세요).</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** ---------------- UI Components ---------------- */

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

function ToggleField(props: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
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

/** ---------------- Styles ---------------- */

const styles: Record<string, React.CSSProperties> = {
  page: {
    padding: 16,
    fontFamily:
      'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif',
    color: "#111827",
    background: "#ffffff",
  },
  headerRow: {
    display: "flex",
    gap: 12,
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 16,
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

  /* modal */
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
  modalMsg: { fontSize: 14, lineHeight: 1.5 },
  pathBox: {
    border: "1px solid #E5E7EB",
    borderRadius: 12,
    padding: 12,
    background: "#FAFAFA",
  },
  pathLabel: { fontSize: 12, fontWeight: 800, color: "#374151", marginBottom: 6 },
  pathLine: { fontSize: 14, fontWeight: 800, display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" },
  pathNode: {
    padding: "2px 8px",
    borderRadius: 999,
    border: "1px solid #E5E7EB",
    background: "#FFFFFF",
  },
  pathArrow: { margin: "0 4px", color: "#6B7280" },
  modalControls: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 },
  currentSmall: { fontSize: 12, color: "#374151", fontWeight: 700 },
  nextSmall: { fontSize: 12, color: "#B45309", fontWeight: 900 },

  primaryBtn: {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid #111827",
    background: "#111827",
    color: "#FFFFFF",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 900,
    opacity: 1,
  },

  preview: {
    marginTop: 16,
    border: "1px solid #E5E7EB",
    borderRadius: 12,
    overflow: "hidden",
  },
  previewTitle: {
    padding: "10px 12px",
    background: "#F9FAFB",
    borderBottom: "1px solid #E5E7EB",
    fontSize: 13,
    fontWeight: 700,
  },
  pre: {
    margin: 0,
    padding: 12,
    fontSize: 12,
    background: "#ffffff",
    overflow: "auto",
    lineHeight: 1.5,
  },
};
