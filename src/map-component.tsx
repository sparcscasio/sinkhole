import { useMemo, useState } from "react";
import { MapContainer, TileLayer, Marker, useMapEvents } from "react-leaflet";
import type { LatLngLiteral } from "leaflet";
import L from "leaflet";

// Leaflet 기본 마커 아이콘 경로 이슈 해결 (Vite/TS 환경)
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: new URL(
    "leaflet/dist/images/marker-icon-2x.png",
    import.meta.url
  ).toString(),
  iconUrl: new URL(
    "leaflet/dist/images/marker-icon.png",
    import.meta.url
  ).toString(),
  shadowUrl: new URL(
    "leaflet/dist/images/marker-shadow.png",
    import.meta.url
  ).toString(),
});

// --------------------
// 타입 정의
// --------------------
export interface ClickMapProps {
  onSelect?: (coord: LatLngLiteral) => void;
  initialCenter?: [number, number];
  initialZoom?: number;
}

interface ClickHandlerProps {
  onSelect: (coord: LatLngLiteral) => void;
}

// --------------------
// 지도 클릭 핸들러
// --------------------
function ClickHandler({ onSelect }: ClickHandlerProps) {
  useMapEvents({
    click(e) {
      onSelect(e.latlng);
    },
  });
  return null;
}

// --------------------
// 메인 컴포넌트
// --------------------
export default function ClickMap({
  onSelect,
  initialCenter = [37.5665, 126.978], // 서울 시청
  initialZoom = 11,
}: ClickMapProps) {
  const [selected, setSelected] = useState<LatLngLiteral | null>(null);

  const handleSelect = (coord: LatLngLiteral) => {
    setSelected(coord);
    onSelect?.(coord);
  };

  const markerPos = useMemo<[number, number] | null>(() => {
    if (!selected) return null;
    return [selected.lat, selected.lng];
  }, [selected]);

  return (
    <div style={{ minWidth: 900, height: 450, width: '100%' }}>
      <MapContainer
        center={initialCenter}
        zoom={initialZoom}
        style={{ width: "100%", height: "100%", borderRadius: 12 }}
      >
        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <ClickHandler onSelect={handleSelect} />

        {markerPos && <Marker position={markerPos} />}
      </MapContainer>
    </div>
  );
}
