/** Paleta fija para vincular cada categoría con un color legible */
export const CATEGORY_PALETTE = [
  "#0b6b3a", // verde ingreso
  "#0f6b5c", // teal
  "#1d4ed8", // azul
  "#7c3aed", // violeta
  "#b45309", // ámbar
  "#be123c", // rosa/rojo
  "#0e7490", // cian
  "#4d7c0f", // lima
  "#c2410c", // naranja
  "#334155", // pizarra
  "#9333ea", // púrpura
  "#0369a1", // sky
  "#a16207", // mostaza
  "#9f1239", // crimson
  "#115e59", // verde oscuro
  "#1e3a8a", // navy
];

const BUILTIN_COLORS: Record<string, string> = {
  ads: "#1d4ed8",
  pass: "#b45309",
  nomina: "#7c3aed",
  proveedor: "#c2410c",
  socio: "#7c2d12",
  renta: "#0e7490",
  servicios: "#0369a1",
  apps: "#6d28d9",
  comisiones: "#334155",
  impuestos: "#9f1239",
  evento: "#9333ea",
  transferencia_persona: "#a16207",
  ingreso: "#0b6b3a",
  venta: "#15803d",
  pago: "#0f766e",
  otro: "#64748b",
  revisar: "#9a4d1c",
};

export function colorForCategoryId(id: string, indexHint = 0): string {
  if (BUILTIN_COLORS[id]) return BUILTIN_COLORS[id];
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return CATEGORY_PALETTE[(hash + indexHint) % CATEGORY_PALETTE.length];
}

export function contrastText(bg: string): string {
  const hex = bg.replace("#", "");
  if (hex.length !== 6) return "#fff";
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.62 ? "#1c1914" : "#ffffff";
}
