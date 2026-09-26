// Fixed palette so each connected account gets a stable, visually distinct
// color in the unified calendar/inbox views. Assigned once at connect time.
const PALETTE = [
  "#2563EB", // blue
  "#DC2626", // red
  "#059669", // green
  "#D97706", // amber
  "#7C3AED", // violet
  "#DB2777", // pink
  "#0891B2", // cyan
  "#65A30D", // lime
];

export function nextColor(usedColors: string[]): string {
  const unused = PALETTE.find((c) => !usedColors.includes(c));
  return unused ?? PALETTE[usedColors.length % PALETTE.length];
}
