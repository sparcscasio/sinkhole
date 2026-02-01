import { useEffect, useMemo, useState } from "react";
import type { LatLngLiteral } from "leaflet";
import ClickMap from "./map-component";
import { mapLatLngToRegion } from "./util/mapRegion";
import { sewerMap } from "./util/sewerMap";
import { getRiskLevel, levelStyle, levelText } from "./util/risk";

type Region = {
  sido: string;
  sigungu: string;
};

type PredictResponse =
  | { risk: number; risk_level?: "LOW" | "MEDIUM" | "HIGH"; inputs?: any }
  | { error: string; detail?: string };

const CODE = 'b9dc215cab87';
const API_BASE = `https://${CODE}.ngrok-free.app`;

export default function App() {
  const [coord, setCoord] = useState<LatLngLiteral | null>(null);
  const [regeion, setRegion] = useState<Region | null>(null);
  const average = 0.043393707;
  const [sewer, setSewer] = useState<number>(average);
  const [loading, setLoading] = useState<boolean>(false);

  const [rain3m, setRain3m] = useState<string>("350");
  const [prep, setPrep] = useState<string>("120");
  const [result, setResult] = useState<PredictResponse | null>(null);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    if (!coord) return;

    // async 함수는 effect 안에서 따로 정의
    const fetchRegion = async () => {
      try {
        const reg = await mapLatLngToRegion(coord.lat, coord.lng);
        setRegion(reg);
      } catch (err) {
        console.error("Failed to fetch region:", err);
        setRegion(null);
      }
    };

    fetchRegion();
  }, [coord]);

  useEffect(() => {
    setLoading(true);
    if (!regeion) {
      setSewer(average);
      setLoading(false);
      return;
    }
    console.log(sewerMap);
    console.log(regeion);

    const d = sewerMap[`${regeion.sido}|${regeion.sigungu}`]
    console.log(d);
    setSewer(d ?? average);
    setLoading(false);
  }, [regeion]);

    const urlPreview = useMemo(() => {
    const u = new URL("/predict", API_BASE);
    u.searchParams.set("rain_3m", rain3m);
    u.searchParams.set("prep", prep);
    u.searchParams.set("sewer_aging_index", sewer.toString());
    return u.toString();
  }, [rain3m, prep, sewer]);

  const onPredict = async () => {
    setError("");
    setResult(null);

    // 간단한 입력 검증
    if (rain3m.trim() === "" || prep.trim() === "" || sewer == null) {
      setError("입력값을 모두 채워줘.");
      return;
    }
    if (Number.isNaN(Number(rain3m)) || Number.isNaN(Number(prep)) || Number.isNaN(Number(sewer))) {
      setError("입력값은 숫자여야 해.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(urlPreview, {
        method: "GET",
        headers: {
          "ngrok-skip-browser-warning": "true",
          "Accept": "application/json",
        },
      });
      const text = await res.text();

      // ngrok/서버가 HTML을 반환하면 여기서 잡힘
      if (text.trim().startsWith("<")) {
        throw new Error("서버가 JSON이 아니라 HTML을 반환했어. 서버/URL을 확인해줘.");
      }

      const data = JSON.parse(text) as PredictResponse;

      if (!res.ok) {
        setResult(data);
        setError(`HTTP ${res.status}`);
      } else {
        setResult(data);
      }
    } catch (e: any) {
      setError(e?.message ?? "요청 실패");
    } finally {
      setLoading(false);
      }
    };

  return (
    <div style={{ padding: 24, width: '100%', alignItems: 'center', boxSizing: 'border-box' }}>
      <ClickMap onSelect={setCoord} />
      <div style={{marginTop: 12}}>
        <label>최근 3달간 누적 강우량</label>
        <input
          value={rain3m}
          onChange={(e) => setRain3m(e.target.value)}
          style={{ width: "100%", padding: 8 }}
          placeholder="예: 350"
        />
      </div>

      <div style={{marginTop: 12}}>
        <label>이번 달 강우량</label>
        <input
          value={prep}
          onChange={(e) => setPrep(e.target.value)}
          style={{ width: "100%", padding: 8 }}
          placeholder="예: 120"
        />
      </div>
      <button
        onClick={onPredict}
        disabled={loading}
        style={{ padding: 10, cursor: loading ? "not-allowed" : "pointer", marginTop: 12 }}
      >
        {loading ? "요청 중..." : "예측 요청 보내기"}
      </button>
      {error && (
        <div style={{ color: "crimson", whiteSpace: "pre-wrap" }}>
          {error}
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        <h4 style={{ margin: "8px 0" }}>결과</h4>

        {!result && (
          <div style={{ background: "#f6f6f6", padding: 12, borderRadius: 10 }}>
            아직 없음
          </div>
        )}

        {result && "error" in result && (
          <div style={{ background: "#FEE2E2", padding: 12, borderRadius: 10, color: "#991B1B" }}>
            오류: {result.error}{result.detail ? ` (${result.detail})` : ""}
          </div>
        )}

        {result && !("error" in result) && (() => {
          const risk = result.risk;
          const level = result.risk_level ?? getRiskLevel(risk);

          return (
            <div
              style={{
                border: "1px solid #eee",
                borderRadius: 12,
                padding: 14,
                background: "#fff",
                maxWidth: 520,
              }}
            >
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <span
                  style={{
                    ...levelStyle(level),
                    padding: "4px 10px",
                    borderRadius: 999,
                    fontSize: 13,
                    fontWeight: 700,
                  }}
                >
                  위험도: {levelText(level)}
                </span>
                <div style={{ fontSize: 28, fontWeight: 800, color: 'black' }}>
                    {(risk * 100).toFixed(1)}%
                  </div>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
