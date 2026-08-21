import React, { useEffect, useState } from "react";
import { CheckCircle2, Star } from "lucide-react";
import { api } from "../api";
import { Tag } from "../components/Shared";

const STATUS_TONE = { contacted: "steel", hired: "amber", completed: "green", not_hired: "steel" };
const STATUS_LABEL = { contacted: "Contacted", hired: "Hired", completed: "Completed", not_hired: "Not hired" };

function ReviewBox({ lead, onDone }) {
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError("");
    try {
      await api.submitReview({ leadId: lead.id, rating, comment });
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ padding: 14, marginTop: 8 }}>
      <div style={{ fontSize: 12.5, color: "var(--steel)", marginBottom: 8 }}>Leave a review for {lead.artisan_name}</div>
      <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Star key={n} size={20} fill={n <= rating ? "var(--amber)" : "none"} color="var(--amber)" style={{ cursor: "pointer" }} onClick={() => setRating(n)} />
        ))}
      </div>
      <textarea className="input" placeholder="How did the job go?" value={comment} onChange={(e) => setComment(e.target.value)} style={{ minHeight: 60, resize: "vertical" }} />
      {error && <div className="error-text">{error}</div>}
      <button className="btn-primary" style={{ marginTop: 8 }} disabled={busy} onClick={submit}>SUBMIT REVIEW</button>
    </div>
  );
}

export default function MyLeads() {
  const [leads, setLeads] = useState([]);
  const [reviewing, setReviewing] = useState(null);

  function load() {
    api.myLeads().then(setLeads);
  }
  useEffect(load, []);

  async function markComplete(id) {
    await api.completeLead(id);
    load();
  }

  return (
    <div>
      <div className="display" style={{ fontSize: 22, color: "var(--navy)", fontWeight: 600 }}>Your requests</div>
      <div style={{ fontSize: 13, color: "var(--steel)", marginTop: 2 }}>Every pro you've contacted through NearHandsAT.</div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 20 }}>
        {leads.map((l) => (
          <div key={l.id} className="card" style={{ padding: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
              <div style={{ fontWeight: 600, color: "var(--navy)", fontSize: 14 }}>{l.artisan_name}</div>
              <Tag tone={STATUS_TONE[l.status]}>{STATUS_LABEL[l.status]}</Tag>
            </div>
            <div style={{ fontSize: 11.5, color: "var(--steel)", marginTop: 4 }}>Contacted {l.created_at}</div>

            {l.status === "hired" && (
              <button className="btn-secondary" style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 6 }} onClick={() => markComplete(l.id)}>
                <CheckCircle2 size={14} /> MARK JOB COMPLETE
              </button>
            )}

            {l.status === "completed" && reviewing !== l.id && (
              <button className="btn-secondary" style={{ marginTop: 10 }} onClick={() => setReviewing(l.id)}>LEAVE A REVIEW</button>
            )}

            {reviewing === l.id && (
              <ReviewBox lead={l} onDone={() => { setReviewing(null); load(); }} />
            )}
          </div>
        ))}
        {leads.length === 0 && <div style={{ fontSize: 13, color: "var(--steel)" }}>No requests yet — search for a pro to get started.</div>}
      </div>
    </div>
  );
}
