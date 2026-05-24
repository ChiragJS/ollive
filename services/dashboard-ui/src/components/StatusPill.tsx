interface Props {
  status: string;
}

export function StatusPill({ status }: Props) {
  let cls = "pill--muted";
  if (status === "success" || status === "completed" || status === "ok") cls = "pill--success";
  else if (status === "error" || status === "failed" || status === "timeout") cls = "pill--error";
  else if (status === "cancelled") cls = "pill--warn";
  else if (status === "pending" || status === "in_progress") cls = "pill--info";
  return (
    <span className={`pill ${cls}`}>
      <span className="dot" />
      {status}
    </span>
  );
}
