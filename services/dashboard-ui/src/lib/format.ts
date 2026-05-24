export function fmtInt(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("en-US");
}

export function fmtCompact(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  const abs = Math.abs(n);
  if (abs < 1000) return String(n);
  if (abs < 1_000_000) return (n / 1000).toFixed(n % 1000 === 0 ? 0 : 1) + "K";
  if (abs < 1_000_000_000) return (n / 1_000_000).toFixed(1) + "M";
  return (n / 1_000_000_000).toFixed(1) + "B";
}

export function fmtMs(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (n >= 1000) return `${(n / 1000).toFixed(2)} s`;
  return `${Math.round(n)} ms`;
}

export function fmtUsd(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const n = typeof value === "string" ? parseFloat(value) : value;
  if (Number.isNaN(n)) return "—";
  if (n === 0) return "$0.00";
  if (n < 0.001) return `$${n.toFixed(6)}`;
  if (n < 1) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

export function fmtPct(n: number | null | undefined, fractionDigits = 2): string {
  if (n === null || n === undefined) return "—";
  return `${(n * 100).toFixed(fractionDigits)}%`;
}

export function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - then);
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function fmtTimeShort(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-US", { month: "short", day: "2-digit" })} ${d.toLocaleTimeString(
    "en-US",
    { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }
  )}`;
}
