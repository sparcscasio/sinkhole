export function getRiskLevel(risk: number): "LOW" | "MEDIUM" | "HIGH" {
  if (risk >= 0.7) return "HIGH";
  if (risk >= 0.4) return "MEDIUM";
  return "LOW";
}

export function levelText(level: "LOW" | "MEDIUM" | "HIGH") {
  if (level === "HIGH") return "높음";
  if (level === "MEDIUM") return "중간";
  return "낮음";
}

export function levelStyle(level: "LOW" | "MEDIUM" | "HIGH"): React.CSSProperties {
  // 색은 필요하면 바꿔도 됨 (현재: LOW=초록, MEDIUM=주황, HIGH=빨강)
  if (level === "HIGH") return { background: "#FEE2E2", color: "#991B1B", border: "1px solid #FCA5A5" };
  if (level === "MEDIUM") return { background: "#FFEDD5", color: "#9A3412", border: "1px solid #FDBA74" };
  return { background: "#DCFCE7", color: "#166534", border: "1px solid #86EFAC" };
}