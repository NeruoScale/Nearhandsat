import React, { useEffect, useState } from "react";
import { Plus, Pencil, EyeOff, Eye, Check, X as XIcon, AlertTriangle } from "lucide-react";
import { api } from "../api";
import { Tag, Modal } from "./Shared";

export default function PortfolioManager() {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({ label: "", note: "" });
  const [formError, setFormError] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ label: "", note: "" });
  const [confirmItem, setConfirmItem] = useState(null);
  const [banner, setBanner] = useState(null);

  function load() {
    api.myPortfolio().then(setItems);
  }
  useEffect(load, []);

  async function addItem(e) {
    e.preventDefault();
    if (!form.label.trim()) {
      setFormError("Give this piece of work a title.");
      return;
    }
    await api.addPortfolioItem(form);
    setForm({ label: "", note: "" });
    setFormError("");
    load();
  }

  function startEdit(item) {
    setEditingId(item.id);
    setEditForm({ label: item.label, note: item.note });
  }

  async function saveEdit(id) {
    if (!editForm.label.trim()) return;
    await api.updatePortfolioItem(id, editForm);
    setEditingId(null);
    load();
  }

  async function applyHide(item) {
    const res = await api.hidePortfolioItem(item.id);
    if (item.lead_id) {
      const wasHidden = !!item.hidden;
      const before = wasHidden ? res.jobs_completed - 1 : res.jobs_completed + 1;
      setBanner(`Job count updated: ${before} → ${res.jobs_completed}`);
    }
    setConfirmItem(null);
    load();
  }

  function toggleHide(item) {
    const aboutToHide = !item.hidden;
    if (aboutToHide && item.lead_id) {
      setConfirmItem(item);
      return;
    }
    applyHide(item);
  }

  return (
    <div>
      {banner && (
        <div
          style={{
            marginTop: 14,
            background: "#FBEBD4",
            border: "1px solid var(--amber)",
            borderRadius: 8,
            padding: "10px 14px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 10,
            fontSize: 12.5,
            color: "var(--amber-dark)",
          }}
        >
          <span>{banner}</span>
          <button onClick={() => setBanner(null)} style={{ background: "none", border: "none", padding: 0, display: "flex" }}>
            <XIcon size={14} color="var(--amber-dark)" />
          </button>
        </div>
      )}

      <form onSubmit={addItem} style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input className="input" style={{ flex: "1 1 160px" }} placeholder="Job title" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
        <input className="input" style={{ flex: "1 1 160px" }} placeholder="Short note" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        <button className="btn-primary" style={{ display: "flex", alignItems: "center", gap: 6 }}><Plus size={14} /> ADD</button>
      </form>
      {formError && <div className="error-text">{formError}</div>}

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14 }}>
        {items.map((p) => (
          <div key={p.id} className="card" style={{ padding: 12 }}>
            {editingId === p.id ? (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <input className="input" style={{ flex: "1 1 140px" }} value={editForm.label} onChange={(e) => setEditForm({ ...editForm, label: e.target.value })} />
                <input className="input" style={{ flex: "1 1 140px" }} value={editForm.note} onChange={(e) => setEditForm({ ...editForm, note: e.target.value })} />
                <button className="btn-primary" style={{ display: "flex", alignItems: "center", gap: 4 }} onClick={() => saveEdit(p.id)}><Check size={14} /> SAVE</button>
                <button className="btn-secondary" style={{ display: "flex", alignItems: "center", gap: 4 }} onClick={() => setEditingId(null)}><XIcon size={14} /> CANCEL</button>
              </div>
            ) : (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <div style={{ fontSize: 13, color: "#3C3A33" }}>
                  <strong style={{ color: "var(--navy)" }}>{p.label}</strong> — {p.note}
                  {!!p.hidden && <span style={{ marginLeft: 6 }}><Tag tone="steel">Hidden</Tag></span>}
                  {!!p.lead_id && <span style={{ marginLeft: 6 }}><Tag tone="amber">Confirmed job</Tag></span>}
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <button className="btn-secondary" style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 10px" }} onClick={() => startEdit(p)}>
                    <Pencil size={13} /> EDIT
                  </button>
                  <button className="btn-secondary" style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 10px" }} onClick={() => toggleHide(p)}>
                    {p.hidden ? <Eye size={13} /> : <EyeOff size={13} />} {p.hidden ? "SHOW" : "HIDE"}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
        {items.length === 0 && <div style={{ fontSize: 13, color: "var(--steel)" }}>No portfolio items yet.</div>}
      </div>

      {confirmItem && (
        <Modal onClose={() => setConfirmItem(null)}>
          <div style={{ display: "flex", gap: 10 }}>
            <AlertTriangle size={20} color="var(--amber-dark)" style={{ flexShrink: 0, marginTop: 2 }} />
            <div>
              <div className="display" style={{ fontSize: 16, color: "var(--navy)", fontWeight: 600 }}>Hide this item?</div>
              <div style={{ fontSize: 13, color: "#3C3A33", marginTop: 8, lineHeight: 1.5 }}>
                This is linked to a confirmed job. Hiding it will lower your job count and ranking score. Continue?
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
            <button className="btn-secondary" style={{ flex: 1 }} onClick={() => setConfirmItem(null)}>CANCEL</button>
            <button className="btn-primary" style={{ flex: 1 }} onClick={() => applyHide(confirmItem)}>HIDE IT</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
