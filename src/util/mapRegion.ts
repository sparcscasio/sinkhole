import { point } from "@turf/helpers";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";

export async function mapLatLngToRegion(lat: number, lon: number) {
  const geo = await fetch("/skorea-municipalities-geo.json").then(r => r.json());
  const p = point([lon, lat]);

  for (const f of geo.features) {
    if (booleanPointInPolygon(p, f)) {
      return { sido: f.properties.NAME_1, sigungu: f.properties.NAME_2 };
    }
  }
  return null;
}
