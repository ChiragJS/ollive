export function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - then);
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

export function dayGroup(iso: string): "Today" | "Yesterday" | "Previous 7 days" | "Previous 30 days" | "Older" {
  const d = new Date(iso);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const oneDay = 24 * 60 * 60 * 1000;
  const ts = d.getTime();
  if (ts >= startOfToday) return "Today";
  if (ts >= startOfToday - oneDay) return "Yesterday";
  if (ts >= startOfToday - 7 * oneDay) return "Previous 7 days";
  if (ts >= startOfToday - 30 * oneDay) return "Previous 30 days";
  return "Older";
}

export function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Working late";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  if (h < 22) return "Good evening";
  return "Good evening";
}
