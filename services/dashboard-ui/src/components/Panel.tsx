import type { ReactNode } from "react";

interface Props {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  children: ReactNode;
  flush?: boolean;
}

export function Panel({ title, subtitle, right, children, flush }: Props) {
  return (
    <section className="panel">
      <div className="panel__hd">
        <span className="panel__title">{title}</span>
        {subtitle ? <span className="panel__sub">{subtitle}</span> : null}
        <span className="spacer" />
        {right}
      </div>
      <div className={`panel__body ${flush ? "panel__body--flush" : ""}`}>{children}</div>
    </section>
  );
}
