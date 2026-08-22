import React, { useEffect, useState } from "react";
import { ArrowLeft, MapPin, Star, CheckCircle2, MessageCircle, Send, X } from "lucide-react";
import { api } from "../api";
import { ICONS, Tag, Gauge, Modal, formatLocation } from "../components/Shared";
import { useLeadThread } from "../hooks/useLeadThread";
import { useLanguage } from "../i18n";
import Auth from "./Auth";

function formatRelative(sqlDatetime, t) {
  if (!sqlDatetime) return null;
  const then = new Date(sqlDatetime.replace(" ", "T") + "Z").getTime();
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 1) return t.profile.justNow;
  if (mins < 60) return t.profile.minutesAgo(mins);
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t.profile.hoursAgo(hours);
  const days = Math.floor(hours / 24);
  return t.profile.daysAgo(days);
}

function ContactFlow({ artisan, user, onGuestAuth, onClose, onHired }) {
  const { t } = useLanguage();
  const [leadId, setLeadId] = useState(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [hired, setHired] = useState(false);
  const { messages, send } = useLeadThread(leadId);

  // Guests can browse and view profiles freely, but contacting a pro
  // requires an account. Show sign-in/signup inline, right here in the
  // modal -- on success `user` becomes truthy and this same component
  // instance falls through to the normal compose flow below, so the
  // visitor never loses their place or has to re-click Contact.
  if (!user) {
    return (
      <div>
        <button onClick={onClose} style={{ position: "absolute", top: 14, right: 14, background: "none", border: "none" }}><X size={18} color="var(--steel)" /></button>
        <div className="display" style={{ fontSize: 18, color: "var(--navy)", fontWeight: 600 }}>{t.profile.contactFlow.signInToMessage(artisan.name)}</div>
        <div style={{ fontSize: 12, color: "var(--steel)", marginTop: 4, marginBottom: 16, lineHeight: 1.5 }}>
          {t.profile.contactFlow.signInDesc}
        </div>
        <Auth compact initialMode="register" initialRole="client" lockRole="client" onAuth={onGuestAuth} />
      </div>
    );
  }

  async function sendFirst() {
    if (!draft.trim()) {
      setError(t.profile.contactFlow.describeBeforeSending);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await api.createLead({ artisanId: artisan.id, message: draft });
      setLeadId(res.id);
      setDraft("");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function sendMore() {
    if (!draft.trim()) return;
    setBusy(true);
    try {
      await send(draft);
      setDraft("");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmHire() {
    setBusy(true);
    try {
      await api.confirmHire(leadId);
      setHired(true);
      onHired();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (hired) {
    return (
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <CheckCircle2 size={22} color="var(--green)" />
          <div className="display" style={{ fontSize: 18, color: "var(--navy)", fontWeight: 600 }}>{t.profile.contactFlow.hireConfirmedTitle}</div>
        </div>
        <div style={{ fontSize: 13, color: "var(--steel)", marginTop: 8, lineHeight: 1.5 }}>
          {t.profile.contactFlow.hireConfirmedDesc}
        </div>
        <button className="btn-primary" style={{ width: "100%", marginTop: 16 }} onClick={onClose}>{t.profile.contactFlow.done}</button>
      </div>
    );
  }

  if (!leadId) {
    return (
      <div>
        <button onClick={onClose} style={{ position: "absolute", top: 14, right: 14, background: "none", border: "none" }}><X size={18} color="var(--steel)" /></button>
        <div className="display" style={{ fontSize: 18, color: "var(--navy)", fontWeight: 600 }}>{t.profile.contactFlow.message(artisan.name)}</div>
        <div style={{ fontSize: 12, color: "var(--steel)", marginTop: 4 }}>{t.profile.contactFlow.staysInApp}</div>
        <textarea
          className="input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t.profile.contactFlow.describePlaceholder}
          style={{ minHeight: 90, marginTop: 16, resize: "vertical" }}
        />
        {error && <div className="error-text">{error}</div>}
        <button className="btn-primary" style={{ width: "100%", marginTop: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }} disabled={busy} onClick={sendFirst}>
          <Send size={14} /> {t.profile.contactFlow.sendMessage}
        </button>
      </div>
    );
  }

  return (
    <div>
      <button onClick={onClose} style={{ position: "absolute", top: 14, right: 14, background: "none", border: "none" }}><X size={18} color="var(--steel)" /></button>
      <div className="display" style={{ fontSize: 18, color: "var(--navy)", fontWeight: 600 }}>{t.profile.contactFlow.conversation}</div>
      <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10, maxHeight: 220, overflowY: "auto" }}>
        {messages.map((m) => {
          const mine = m.sender_id === user.id;
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
                maxWidth: "80%",
              }}
            >
              {m.content}
            </div>
          );
        })}
      </div>
      <textarea
        className="input"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={t.profile.contactFlow.followUpPlaceholder}
        style={{ minHeight: 60, marginTop: 12, resize: "vertical" }}
      />
      {error && <div className="error-text">{error}</div>}
      <button className="btn-secondary" style={{ width: "100%", marginTop: 8 }} disabled={busy} onClick={sendMore}>{t.profile.contactFlow.send}</button>

      <div style={{ marginTop: 18, padding: 12, background: "#FBEBD4", borderRadius: 6, fontSize: 12, color: "var(--amber-dark)" }}>
        {t.profile.contactFlow.hireBanner}
      </div>
      <button className="btn-primary" style={{ width: "100%", marginTop: 10, background: "var(--green)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }} disabled={busy} onClick={confirmHire}>
        <CheckCircle2 size={15} /> {t.profile.contactFlow.iHired(artisan.name.split(" ")[0].toUpperCase())}
      </button>
    </div>
  );
}

export default function Profile({ artisanId, onBack, user, onGuestAuth }) {
  const { t } = useLanguage();
  const [artisan, setArtisan] = useState(null);
  const [contacting, setContacting] = useState(false);

  useEffect(() => {
    api.getArtisan(artisanId).then(setArtisan);
  }, [artisanId]);

  if (!artisan) return <div style={{ padding: 40, textAlign: "center", color: "var(--steel)" }}>{t.common.loading}</div>;

  const Icon = ICONS[artisan.trade] || ICONS.Electrician;
  const ratio = artisan.conversion_ratio !== null ? Math.round(artisan.conversion_ratio * 100) : null;

  return (
    <div>
      <button onClick={onBack} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "var(--steel)", fontSize: 13, padding: 0, marginBottom: 18 }}>
        <ArrowLeft size={15} /> {t.profile.backToSearch}
      </button>

      <div style={{ display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ width: 64, height: 64, borderRadius: 10, background: "var(--navy)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Icon size={30} color="var(--chalk)" />
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div className="display" style={{ fontSize: 26, color: "var(--navy)", fontWeight: 600 }}>{artisan.name}</div>
          <div style={{ fontSize: 13, color: "var(--steel)", display: "flex", alignItems: "center", gap: 4, marginTop: 2 }}>
            <MapPin size={12} />{formatLocation(artisan)} · {artisan.trade}
            {artisan.service_radius_km ? t.profile.travelsUpTo(artisan.service_radius_km) : ""}
          </div>
          <div style={{ fontSize: 12, color: artisan.online ? "var(--green)" : "var(--steel)", display: "flex", alignItems: "center", gap: 5, marginTop: 4 }}>
            {artisan.online ? (
              <>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--green)", display: "inline-block" }} />
                {t.profile.online}
              </>
            ) : (
              <span>{artisan.last_seen_at ? t.profile.lastSeen(formatRelative(artisan.last_seen_at, t)) : t.profile.offline}</span>
            )}
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
            <Tag tone="amber"><Star size={10} style={{ verticalAlign: -1, marginRight: 3 }} />{Number(artisan.avg_rating).toFixed(1)} ({t.profile.reviewsCount(artisan.review_count)})</Tag>
            {artisan.jobs_completed >= 15 && <Tag tone="green"><CheckCircle2 size={10} style={{ verticalAlign: -1, marginRight: 3 }} />{t.profile.verified}</Tag>}
            {ratio !== null && <Tag>{t.profile.leadToHire(ratio)}</Tag>}
          </div>
        </div>
        <Gauge value={artisan.jobs_completed} max={Math.max(60, artisan.jobs_completed)} />
      </div>

      <div style={{ marginTop: 24, fontSize: 14, lineHeight: 1.6, color: "#3C3A33" }}>{artisan.bio}</div>

      <button className="btn-primary" style={{ marginTop: 18, display: "flex", alignItems: "center", gap: 7 }} onClick={() => setContacting(true)}>
        <MessageCircle size={16} /> {t.profile.contact(artisan.name.split(" ")[0].toUpperCase())}
      </button>

      <div className="display" style={{ marginTop: 32, fontSize: 13, color: "var(--steel)", letterSpacing: 1.5, borderBottom: "1px solid var(--line)", paddingBottom: 8 }}>{t.profile.pastWork}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 12, marginTop: 14 }}>
        {artisan.portfolio.map((p) => (
          <div key={p.id} className="card" style={{ overflow: "hidden" }}>
            <div style={{ height: 76, background: "linear-gradient(135deg, var(--navy), var(--navy-light))", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Icon size={22} color="#A9B4CC" />
            </div>
            <div style={{ padding: "8px 10px" }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--navy)" }}>{p.label}</div>
              <div style={{ fontSize: 11, color: "var(--steel)", marginTop: 2 }}>{p.note}</div>
            </div>
          </div>
        ))}
        {artisan.portfolio.length === 0 && <div style={{ fontSize: 13, color: "var(--steel)" }}>{t.profile.noPortfolio}</div>}
      </div>

      <div className="display" style={{ marginTop: 32, fontSize: 13, color: "var(--steel)", letterSpacing: 1.5, borderBottom: "1px solid var(--line)", paddingBottom: 8 }}>{t.profile.reviews}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 14 }}>
        {artisan.reviews.map((r) => (
          <div key={r.id} style={{ borderLeft: "3px solid var(--amber)", paddingLeft: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--navy)" }}>{r.author}</span>
              <span style={{ display: "flex", gap: 1 }}>
                {Array.from({ length: 5 }).map((_, j) => (
                  <Star key={j} size={11} fill={j < r.rating ? "var(--amber)" : "none"} color="var(--amber)" />
                ))}
              </span>
            </div>
            <div style={{ fontSize: 13, color: "#3C3A33", marginTop: 3 }}>{r.comment}</div>
          </div>
        ))}
        {artisan.reviews.length === 0 && <div style={{ fontSize: 13, color: "var(--steel)" }}>{t.profile.noReviews}</div>}
      </div>

      {contacting && (
        <Modal onClose={() => setContacting(false)}>
          <ContactFlow artisan={artisan} user={user} onGuestAuth={onGuestAuth} onClose={() => setContacting(false)} onHired={() => api.getArtisan(artisanId).then(setArtisan)} />
        </Modal>
      )}
    </div>
  );
}
