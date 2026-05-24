import { NavLink } from "react-router-dom";
import { Icon } from "./Icon";

const ITEMS = [
  { to: "/", end: true, icon: "gauge" as const, label: "Overview" },
  { to: "/logs", end: false, icon: "list" as const, label: "Inference logs" },
  { to: "/models", end: false, icon: "layers" as const, label: "Models" },
];

export function SideNav() {
  return (
    <aside className="sidenav">
      <NavLink to="/" className="sidenav__logo" title="Ollive Observability">
        <Icon name="logo" size={20} strokeWidth={2.2} />
      </NavLink>
      {ITEMS.map((it) => (
        <NavLink
          key={it.to}
          to={it.to}
          end={it.end}
          className={({ isActive }) => `sidenav__item ${isActive ? "is-active" : ""}`}
        >
          <Icon name={it.icon} size={19} />
          <span className="sidenav__tip">{it.label}</span>
        </NavLink>
      ))}
      <div className="sidenav__bottom">
        <a
          href="http://localhost:5173"
          target="_blank"
          rel="noreferrer"
          className="sidenav__item"
          title="Open chat app"
        >
          <Icon name="external" size={17} />
          <span className="sidenav__tip">Open chat</span>
        </a>
      </div>
    </aside>
  );
}
