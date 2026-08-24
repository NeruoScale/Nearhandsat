import React, { useEffect, useRef, useState } from "react";
import { CheckCircle2, Star, ChevronDown, ChevronUp, Paperclip, Send } from "lucide-react";
import { api } from "../api";
import { Tag } from "../components/Shared";
import ChatAttachment from "../components/ChatAttachment";
import { useLeadThread } from "../hooks/useLeadThread";
import { useLanguage } from "../i18n";

const STATUS_TONE = { contacted: "steel", hired: "amber", completed: "green", not_hired: "steel" };

// Mirrors ArtisanDashboard.jsx's RequestRow thread view -- before roadmap
// #5, a client had no way to continue a conversation except by
// re-navigating to the artisan's profile; this closes that gap the same
// way the professional side already needed one.
function LeadThread({ leadId, userId }) {
  const { t } = useLanguage();
  const { messages, loading, send, sendAttachment } = useLeadThread(leadId);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef(null);

  async function sendDraft() {
    if (!draft.trim()) return;
    setBusy(true);
    try {
      await send(draft);
      setDraft("");
    } finally {
      setBusy(false);
    }
  }

  async function handleFilePick(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      await sendAttachment(file);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 10 }} onClick={(e) => e.stopPropagation()}>
      {loading ? (
        <div style={{ fontSize: 12.5, color: "var(--steel)" }}>{t.dashboard.requestRow.loadingConversation}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 240, overflowY: "auto" }}>
          {messages.map((m) => {
            const mine = m.sender_id === userId;
            return (
              <div
                key={m.id}
                style={{
                  alignSelf: mine ? "flex-end" : "flex-start",
                  background: mine ? "var(--navy)" : "var(--chalk)",
                  color: mine ? "var(--chalk)" : "#1A1A17",
                  border: mine ? "none" : "1px solid var(--line)",
                  padding: "8px 12px",
                  borderRadius: mine ? "8px 8px 2px 8px" : "8px 8px 8px 2px",
                  fontSize: 13,
                  maxWidth: "85%",
                }}
              >
                {m.message_type && m.message_type !== "text" ? (
                  <ChatAttachment messageType={m.message_type} attachmentKey={m.attachment_key} />
                ) : (
                  m.content
                )}
              </div>
            );
          })}
          {messages.length === 0 && <div style={{ fontSize: 12.5, color: "var(--steel)" }}>{t.dashboard.requestRow.noMessages}</div>}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <input ref={fileInputRef} type="file" accept="image/*,video/*" onChange={handleFilePick} style={{ display: "none" }} />
        <input
          className="input"
          style={{ flex: 1, padding: "8px 10px", fontSize: 13 }}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t.profile.contactFlow.followUpPlaceholder}
          onKeyDown={(e) => e.key === "Enter" && sendDraft()}
        />
        <button className="btn-secondary" style={{ flexShrink: 0, padding: "8px 10px" }} disabled={busy} onClick={() => fileInputRef.current.click()} title={t.profile.contactFlow.attach}>
          <Paperclip size={14} />
        </button>
        <button className="btn-secondary" style={{ flexShrink: 0, padding: "8px 10px" }} disabled={busy} onClick={sendDraft} title={t.profile.contactFlow.send}>
          <Send size={14} />
        </button>
      </div>
    </div>
  );
}

function ReviewBox({ lead, onDone }) {
  const { t } = useLanguage();
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
      <div style={{ fontSize: 12.5, color: "var(--steel)", marginBottom: 8 }}>{t.myLeads.reviewBox.leaveReviewFor(lead.artisan_name)}</div>
      <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Star key={n} size={20} fill={n <= rating ? "var(--amber)" : "none"} color="var(--amber)" style={{ cursor: "pointer" }} onClick={() => setRating(n)} />
        ))}
      </div>
      <textarea className="input" placeholder={t.myLeads.reviewBox.placeholder} value={comment} onChange={(e) => setComment(e.target.value)} style={{ minHeight: 60, resize: "vertical" }} />
      {error && <div className="error-text">{error}</div>}
      <button className="btn-primary" style={{ marginTop: 8 }} disabled={busy} onClick={submit}>{t.myLeads.reviewBox.submit}</button>
    </div>
  );
}

export default function MyLeads({ user }) {
  const { t } = useLanguage();
  const [leads, setLeads] = useState([]);
  const [reviewing, setReviewing] = useState(null);
  const [expandedId, setExpandedId] = useState(null);

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
      <div className="display" style={{ fontSize: 22, color: "var(--navy)", fontWeight: 600 }}>{t.myLeads.title}</div>
      <div style={{ fontSize: 13, color: "var(--steel)", marginTop: 2 }}>{t.myLeads.subtitle}</div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 20 }}>
        {leads.map((l) => (
          <div key={l.id} className="card" style={{ padding: 14 }}>
            <div
              onClick={() => setExpandedId(expandedId === l.id ? null : l.id)}
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, cursor: "pointer" }}
            >
              <div style={{ fontWeight: 600, color: "var(--navy)", fontSize: 14 }}>{l.artisan_name}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Tag tone={STATUS_TONE[l.status]}>{t.common.status[l.status]}</Tag>
                {expandedId === l.id ? <ChevronUp size={16} color="var(--steel)" /> : <ChevronDown size={16} color="var(--steel)" />}
              </div>
            </div>
            <div style={{ fontSize: 11.5, color: "var(--steel)", marginTop: 4 }}>{t.myLeads.contacted(l.created_at)}</div>
            {l.service_title && (
              <div style={{ fontSize: 11.5, color: "var(--steel)", marginTop: 2 }}>{t.services.relatedTo(l.service_title)}</div>
            )}

            {expandedId === l.id && <LeadThread leadId={l.id} userId={user.id} />}

            {l.status === "hired" && (
              <button className="btn-secondary" style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 6 }} onClick={() => markComplete(l.id)}>
                <CheckCircle2 size={14} /> {t.myLeads.markComplete}
              </button>
            )}

            {l.status === "completed" && reviewing !== l.id && (
              <button className="btn-secondary" style={{ marginTop: 10 }} onClick={() => setReviewing(l.id)}>{t.myLeads.leaveReview}</button>
            )}

            {reviewing === l.id && (
              <ReviewBox lead={l} onDone={() => { setReviewing(null); load(); }} />
            )}
          </div>
        ))}
        {leads.length === 0 && <div style={{ fontSize: 13, color: "var(--steel)" }}>{t.myLeads.noRequests}</div>}
      </div>
    </div>
  );
}
