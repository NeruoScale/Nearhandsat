import React, { useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { api } from "../api";
import { connectSocket } from "../socket";
import { useLanguage } from "../i18n";

// Minimal notification UI: a badge + dropdown, not a full notification
// center. Unread count starts from a REST fetch, then stays live via the
// existing socket connection's per-user room (see server/index.js) --
// reuses the one socket this app already keeps open, no new realtime
// framework.
export default function NotificationBell({ onNavigate }) {
  const { t } = useLanguage();
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const boxRef = useRef(null);

  useEffect(() => {
    api.getUnreadCount().then((r) => setCount(r.count));
    const socket = connectSocket();
    function onNew() {
      setCount((c) => c + 1);
    }
    socket.on("notification:new", onNew);
    return () => socket.off("notification:new", onNew);
  }, []);

  useEffect(() => {
    if (!open) return;
    api.getNotifications({ limit: 10 }).then((r) => setItems(r.results));
    function onClickOutside(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  async function openNotification(n) {
    if (!n.read_at) {
      await api.markNotificationRead(n.id);
      setCount((c) => Math.max(0, c - 1));
      setItems((prev) => prev.map((it) => (it.id === n.id ? { ...it, read_at: "now" } : it)));
    }
    setOpen(false);
    onNavigate();
  }

  return (
    <div ref={boxRef} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{ background: "none", border: "none", color: "#C7CEDD", position: "relative", display: "flex", padding: 4 }}
      >
        <Bell size={16} />
        {count > 0 && (
          <span
            className="mono"
            style={{
              position: "absolute", top: -2, right: -4, background: "var(--amber)", color: "#2A1B04",
              fontSize: 9, fontWeight: 700, borderRadius: 8, minWidth: 15, height: 15, padding: "0 3px",
              display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1,
            }}
          >
            {count > 9 ? "9+" : count}
          </span>
        )}
      </button>
      {open && (
        <div
          className="card"
          style={{
            position: "absolute", insetInlineEnd: 0, top: "calc(100% + 8px)", width: 280,
            maxHeight: 320, overflowY: "auto", padding: 6, zIndex: 30,
          }}
        >
          {items.length === 0 && (
            <div style={{ fontSize: 12.5, color: "var(--steel)", padding: 10 }}>{t.dashboard.noLeads}</div>
          )}
          {items.map((n) => (
            <div
              key={n.id}
              onClick={() => openNotification(n)}
              style={{
                padding: "8px 10px", borderRadius: 6, cursor: "pointer", fontSize: 12.5,
                background: n.read_at ? "transparent" : "#FBEBD4",
              }}
            >
              <div style={{ fontWeight: 600, color: "var(--navy)" }}>{n.sender_name}</div>
              {n.service_title && <div style={{ color: "var(--steel)", fontSize: 11 }}>{t.services.relatedTo(n.service_title)}</div>}
              <div style={{ color: "#3C3A33", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {n.message_preview}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
