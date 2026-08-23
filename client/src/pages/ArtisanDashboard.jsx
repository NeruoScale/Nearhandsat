import React, { useEffect, useState } from "react";
import { TrendingUp, Award, ChevronDown, ChevronUp, Star } from "lucide-react";
import { api } from "../api";
import { Tag } from "../components/Shared";
import PortfolioManager from "../components/PortfolioManager";
import ServiceManager from "../components/ServiceManager";
import LocationManager from "../components/LocationManager";
import { useLeadThread } from "../hooks/useLeadThread";
import { useLanguage } from "../i18n";

const STATUS_TONE = { contacted: "steel", hired: "amber", completed: "green", not_hired: "steel" };

function truncate(str, n) {
  if (!str) return "";
  return str.length > n ? str.slice(0, n) + "…" : str;
}

function formatDate(sqlDatetime) {
  if (!sqlDatetime) return "";
  const d = new Date(sqlDatetime.replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return sqlDatetime;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function RequestRow({ lead, user, expanded, onToggle, onSelfReport }) {
  const { t } = useLanguage();
  const { messages: thread, loading: threadLoading } = useLeadThread(expanded ? lead.id : null);
  return (
    <div className="card" style={{ padding: 14 }}>
      <div
        onClick={onToggle}
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, cursor: "pointer", flexWrap: "wrap" }}
      >
        <div style={{ flex: "1 1 220px", minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 600, color: "var(--navy)", fontSize: 14 }}>{lead.client_name}</span>
            <Tag tone={STATUS_TONE[lead.status]}>{t.common.status[lead.status]}</Tag>
          </div>
          <div style={{ fontSize: 12.5, color: "var(--steel)", marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {truncate(lead.first_message, 60)}
          </div>
          <div style={{ fontSize: 11, color: "var(--steel)", marginTop: 4 }}>{t.dashboard.requestRow.requested(formatDate(lead.created_at))}</div>
        </div>
        {expanded ? <ChevronUp size={16} color="var(--steel)" /> : <ChevronDown size={16} color="var(--steel)" />}
      </div>

      {expanded && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--line)" }}>
          {threadLoading ? (
            <div style={{ fontSize: 12.5, color: "var(--steel)" }}>{t.dashboard.requestRow.loadingConversation}</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 240, overflowY: "auto" }}>
              {(thread || []).map((m) => (
                <div
                  key={m.id}
                  style={{
                    alignSelf: m.sender_id === user.id ? "flex-end" : "flex-start",
                    background: m.sender_id === user.id ? "var(--navy)" : "var(--chalk)",
                    color: m.sender_id === user.id ? "var(--chalk)" : "#1A1A17",
                    border: m.sender_id === user.id ? "none" : "1px solid var(--line)",
                    padding: "8px 12px",
                    borderRadius: 8,
                    fontSize: 13,
                    maxWidth: "85%",
                  }}
                >
                  {m.content}
                </div>
              ))}
              {(thread || []).length === 0 && <div style={{ fontSize: 12.5, color: "var(--steel)" }}>{t.dashboard.requestRow.noMessages}</div>}
            </div>
          )}

          {lead.status === "contacted" && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 12, color: "var(--steel)", marginBottom: 8, lineHeight: 1.5 }}>
                {t.dashboard.requestRow.selfReportDesc}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn-secondary" onClick={(e) => { e.stopPropagation(); onSelfReport(lead.id, "hired"); }}>{t.dashboard.requestRow.gotJob}</button>
                <button className="btn-secondary" onClick={(e) => { e.stopPropagation(); onSelfReport(lead.id, "not_hired"); }}>{t.dashboard.requestRow.didntGetIt}</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ArtisanDashboard({ user }) {
  const { t } = useLanguage();
  const [leads, setLeads] = useState([]);
  const [profile, setProfile] = useState(null);
  const [expandedId, setExpandedId] = useState(null);

  function load() {
    api.myLeads().then(setLeads);
    api.getArtisan(user.id).then(setProfile);
  }
  useEffect(load, [user.id]);

  function toggleExpand(lead) {
    setExpandedId(expandedId === lead.id ? null : lead.id);
  }

  async function selfReport(id, outcome) {
    await api.selfReport(id, outcome);
    load();
  }

  if (!profile) return <div style={{ padding: 40, textAlign: "center", color: "var(--steel)" }}>{t.common.loading}</div>;

  const ratio = profile.leads_received ? Math.round((profile.jobs_completed / profile.leads_received) * 100) : 0;
  const belowMinLeads = profile.leads_received < 10;

  return (
    <div>
      <div className="display" style={{ fontSize: 22, color: "var(--navy)", fontWeight: 600 }}>{t.dashboard.title}</div>
      <div style={{ fontSize: 13, color: "var(--steel)", marginTop: 2 }}>{t.dashboard.subtitle(profile.name, profile.trade, profile.city)}</div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginTop: 22 }}>
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontSize: 11, color: "var(--steel)", letterSpacing: 0.5 }}>{t.dashboard.leadsReceived}</div>
          <div className="mono" style={{ fontSize: 26, color: "var(--navy)", marginTop: 4 }}>{profile.leads_received}</div>
        </div>
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontSize: 11, color: "var(--steel)", letterSpacing: 0.5 }}>{t.dashboard.confirmedHires}</div>
          <div className="mono" style={{ fontSize: 26, color: "var(--green)", marginTop: 4 }}>{profile.jobs_completed}</div>
        </div>
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontSize: 11, color: "var(--steel)", letterSpacing: 0.5 }}>{t.dashboard.conversion}</div>
          <div className="mono" style={{ fontSize: 26, color: "var(--amber-dark)", marginTop: 4 }}>{ratio}%</div>
        </div>
      </div>

      <div style={{ marginTop: 20, background: "var(--green-bg)", border: "1px solid var(--green)", borderRadius: 8, padding: 16, display: "flex", gap: 12 }}>
        <TrendingUp size={20} color="var(--green)" style={{ flexShrink: 0, marginTop: 2 }} />
        <div>
          <div className="display" style={{ fontSize: 14, color: "var(--green)", fontWeight: 600 }}>
            {belowMinLeads ? t.dashboard.buildingRanking : t.dashboard.rankingStatus}
          </div>
          <div style={{ fontSize: 12.5, color: "#2E4A38", marginTop: 4, lineHeight: 1.5 }}>
            {belowMinLeads
              ? t.dashboard.buildingRankingDesc
              : t.dashboard.rankingStatusDesc(profile.city, ratio)}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 16, background: "#FBEBD4", border: "1px solid var(--amber)", borderRadius: 8, padding: 16, display: "flex", gap: 12 }}>
        <Award size={20} color="var(--amber-dark)" style={{ flexShrink: 0, marginTop: 2 }} />
        <div>
          <div className="display" style={{ fontSize: 14, color: "var(--amber-dark)", fontWeight: 600 }}>{t.dashboard.freeForNow}</div>
          <div style={{ fontSize: 12.5, color: "#5C4213", marginTop: 4, lineHeight: 1.5 }}>
            {t.dashboard.freeForNowDesc(profile.city)}
          </div>
        </div>
      </div>

      <div className="display" style={{ marginTop: 28, fontSize: 13, color: "var(--steel)", letterSpacing: 1.5, borderBottom: "1px solid var(--line)", paddingBottom: 8 }}>
        {t.dashboard.locationServiceArea}
      </div>
      <div style={{ marginTop: 14 }}>
        <LocationManager profile={profile} onSaved={load} />
      </div>

      <div className="display" style={{ marginTop: 28, fontSize: 13, color: "var(--steel)", letterSpacing: 1.5, borderBottom: "1px solid var(--line)", paddingBottom: 8 }}>
        {t.dashboard.yourRequests}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 14 }}>
        {leads.map((l) => (
          <RequestRow
            key={l.id}
            lead={l}
            user={user}
            expanded={expandedId === l.id}
            onToggle={() => toggleExpand(l)}
            onSelfReport={selfReport}
          />
        ))}
        {leads.length === 0 && <div style={{ fontSize: 13, color: "var(--steel)" }}>{t.dashboard.noLeads}</div>}
      </div>

      <div className="display" style={{ marginTop: 28, fontSize: 13, color: "var(--steel)", letterSpacing: 1.5, borderBottom: "1px solid var(--line)", paddingBottom: 8 }}>
        {t.dashboard.yourReviews}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 14 }}>
        {profile.reviews.map((r) => (
          <div key={r.id} style={{ borderLeft: "3px solid var(--amber)", paddingLeft: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--navy)" }}>{r.author}</span>
              <span style={{ display: "flex", gap: 1 }}>
                {Array.from({ length: 5 }).map((_, j) => (
                  <Star key={j} size={11} fill={j < r.rating ? "var(--amber)" : "none"} color="var(--amber)" />
                ))}
              </span>
              <span style={{ fontSize: 11, color: "var(--steel)" }}>{formatDate(r.created_at)}</span>
            </div>
            <div style={{ fontSize: 13, color: "#3C3A33", marginTop: 3 }}>{r.comment}</div>
          </div>
        ))}
        {profile.reviews.length === 0 && <div style={{ fontSize: 13, color: "var(--steel)" }}>{t.dashboard.noReviews}</div>}
      </div>

      <div className="display" style={{ marginTop: 28, fontSize: 13, color: "var(--steel)", letterSpacing: 1.5, borderBottom: "1px solid var(--line)", paddingBottom: 8 }}>
        {t.dashboard.yourPortfolio}
      </div>
      <PortfolioManager />

      <div className="display" style={{ marginTop: 28, fontSize: 13, color: "var(--steel)", letterSpacing: 1.5, borderBottom: "1px solid var(--line)", paddingBottom: 8 }}>
        {t.services.yourServices}
      </div>
      <ServiceManager />
    </div>
  );
}
