export const sewerMap: Record<string, number> =
  await fetch("/sewer_map.json").then(r => r.json());

