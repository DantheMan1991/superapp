/** Pure display helpers. */

const UNITS = ["B", "KB", "MB", "GB"] as const;

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1);
  return `${rounded} ${UNITS[unit]}`;
}

/** "Contracts / 2026 / Acme" for a breadcrumb or a move-target label. */
export function joinFolderLabels(names: readonly string[]): string {
  return names.join(" / ");
}
