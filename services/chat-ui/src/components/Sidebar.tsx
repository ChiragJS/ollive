import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { chat } from "../api/chat";
import type { ConversationListItem } from "../types";
import { Icon } from "./Icon";
import { dayGroup, fmtRelative } from "../lib/format";

const GROUP_ORDER = ["Today", "Yesterday", "Previous 7 days", "Previous 30 days", "Older"] as const;

const SIDEBAR_KEY = "chat-ui:sidebar-width";
const SIDEBAR_MIN = 220;
const SIDEBAR_MAX = 480;
const SIDEBAR_DEFAULT = 280;

function readPersistedWidth(): number {
  try {
    const v = parseInt(localStorage.getItem(SIDEBAR_KEY) ?? "", 10);
    if (!Number.isFinite(v)) return SIDEBAR_DEFAULT;
    return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, v));
  } catch {
    return SIDEBAR_DEFAULT;
  }
}

interface Props {
  refreshKey?: number;
}

export function Sidebar({ refreshKey = 0 }: Props) {
  const [items, setItems] = useState<ConversationListItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [width, setWidth] = useState<number>(() => readPersistedWidth());
  const [dragging, setDragging] = useState(false);
  const widthRef = useRef(width);
  widthRef.current = width;
  const { id: activeId } = useParams<{ id?: string }>();
  const navigate = useNavigate();

  // Sync width to the CSS var that drives the page grid; persist last value.
  useEffect(() => {
    document.documentElement.style.setProperty("--sidebar-w", `${width}px`);
  }, [width]);
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_KEY, String(width));
    } catch {
      // ignore quota / privacy errors
    }
  }, [width]);

  function onResizePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = widthRef.current;
    setDragging(true);
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";
    const onMove = (me: PointerEvent) => {
      const next = Math.min(
        SIDEBAR_MAX,
        Math.max(SIDEBAR_MIN, startW + (me.clientX - startX))
      );
      setWidth(next);
    };
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setDragging(false);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }

  function onResizeDoubleClick() {
    setWidth(SIDEBAR_DEFAULT);
  }

  useEffect(() => {
    let alive = true;
    chat
      .listConversations(80)
      .then((r) => alive && setItems(r.items))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  async function newChat() {
    setBusy(true);
    try {
      const c = await chat.createConversation();
      navigate(`/c/${c.id}`);
    } finally {
      setBusy(false);
    }
  }

  const grouped = new Map<string, ConversationListItem[]>();
  for (const it of items) {
    const g = dayGroup(it.updated_at);
    if (!grouped.has(g)) grouped.set(g, []);
    grouped.get(g)!.push(it);
  }

  return (
    <aside className="sidebar">
      <div className="sidebar__top">
        <Link to="/" className="brand">
          <span className="brand__mark">o</span>
          <span className="brand__name">
            ollive <em>chat</em>
          </span>
        </Link>
        <button className="btn-new" onClick={newChat} disabled={busy}>
          <Icon name="plus" size={16} />
          <span>New chat</span>
        </button>
      </div>

      <div className="sidebar__list">
        {items.length === 0 ? (
          <div className="side-empty">No conversations yet</div>
        ) : (
          GROUP_ORDER.map((g) => {
            const rows = grouped.get(g);
            if (!rows || rows.length === 0) return null;
            return (
              <div key={g} className="side-group">
                <div className="side-group__hd">{g}</div>
                {rows.map((c) => (
                  <div
                    key={c.id}
                    className={`side-row ${c.id === activeId ? "is-active" : ""}`}
                    onClick={() => navigate(`/c/${c.id}`)}
                  >
                    <span className="side-row__title">{c.title}</span>
                    <span className="side-row__meta">{fmtRelative(c.updated_at)}</span>
                  </div>
                ))}
              </div>
            );
          })
        )}
      </div>

      <div className="sidebar__bottom">
        <span className="avatar">U</span>
        <span>You</span>
        <a className="link-dash" href="http://localhost:5174" target="_blank" rel="noreferrer">
          Dashboard
        </a>
      </div>

      <div
        className={`sidebar__resizer ${dragging ? "is-dragging" : ""}`}
        onPointerDown={onResizePointerDown}
        onDoubleClick={onResizeDoubleClick}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar (double-click to reset)"
        title="Drag to resize · double-click to reset"
      />
    </aside>
  );
}
