export function formatPln(value) {
  return new Intl.NumberFormat("pl-PL", {
    style: "currency",
    currency: "PLN",
    maximumFractionDigits: 2,
  }).format(value ?? 0);
}

export function formatNumber(value, digits = 2) {
  return new Intl.NumberFormat("pl-PL", {
    maximumFractionDigits: digits,
  }).format(value ?? 0);
}

export function formatPercent(value) {
  return new Intl.NumberFormat("pl-PL", {
    style: "percent",
    maximumFractionDigits: 1,
    signDisplay: "always",
  }).format((value ?? 0) / 100);
}

export function formatDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("pl-PL", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

// Compact PLN — "9,0k zł" / "1,2M zł" — for chart axis labels.
export function formatPlnCompact(value) {
  const v = Number(value) || 0;
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1).replace(".", ",")}M zł`;
  if (abs >= 10_000) return `${sign}${Math.round(abs / 1_000)}k zł`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1).replace(".", ",")}k zł`;
  if (abs === 0) return "0 zł";
  return `${sign}${Math.round(abs)} zł`;
}

// Short date — "mar 24" / "wrz 24" — for chart axis labels.
export function formatDateShort(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("pl-PL", {
    month: "short",
    year: "2-digit",
  }).format(new Date(`${value}T00:00:00`));
}
