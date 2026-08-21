import React, { useEffect, useState } from "react";
import { TrendingUp, Award, Plus } from "lucide-react";
import { api } from "../api";
import { Tag } from "../components/Shared";

const STATUS_TONE = { contacted: "steel", hired: "amber", completed: "green", not_hired: "steel" };
const STATUS_LABEL = { contacted: "Contacted", hired: "Hired", completed: "Completed", not_hired: "Not hired" };

export default function ArtisanDashboard({ user }) {
  const [leads, setLeads] = useState([]);
  const [profile, setProfile] = useState(null);
  const [portfolioForm, setPortfolioForm] = useState({ label: "", note: "" });
  const [pfError, setPfError] = useState("");

  function load() {
    api.myLeads().then(setLeads);
    api.getArtisan(user.id).then(setProfile);
  }
  useEffect(load, [user.id]);

  async function selfReport(id, outcome) {
    await api.selfReport(id, outcome);
    load();
  }

  async function addPortfolio(e) {
    e.preventDefault();
    if (!portfolioForm.label.trim()) {
      setPfError("Give this piece of work a title.");
      return;
    }
    await api.addPortfolioItem(portfolioForm);
    setPortfolioForm({ label: "", note: "" });
    setPfError("");
    load();
  }

  if (!profile) return <div style={{ padding: 40, textAlign: "center", color: "var(--steel)" }}>Loading…</div>;

  const ratio = profile.leads_received ? Math.round((profile.jobs_completed / profile.leads_received) * 100) : 0;
  const belowMinLeads = profile.leads_received < 10;
  const pendingConfirmation = leads.filter((l) => l.status === "contacted");

  return (
    <div>
      <div className="display" style={{ fontSize: 22, color: "var(--navy)", fontWeight: 600 }}>Your dashboard</div>
      <div style={{ fontSize: 13, color: "var(--steel)", marginTop: 2 }}>{profile.name} — {profile.trade}, {profile.city}</div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginTop: 22 }}>
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontSize: 11, color: "var(--steel)", letterSpacing: 0.5 }}>LEADS RECEIVED</div>
          <div className="mono" style={{ fontSize: 26, color: "var(--navy)", marginTop: 4 }}>{profile.leads_received}</div>
        </div>
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontSize: 11, color: "var(--steel)", letterSpacing: 0.5 }}>CONFIRMED HIRES</div>
          <div className="mono" style={{ fontSize: 26, color: "var(--green)", marginTop: 4 }}>{profile.jobs_completed}</div>
        </div>
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontSize: 11, color: "var(--steel)", letterSpacing: 0.5 }}>CONVERSION</div>
          <div className="mono" style={{ fontSize: 26, color: "var(--amber-dark)", marginTop: 4 }}>{ratio}%</div>
        </div>
      </div>

      <div style={{ marginTop: 20, background: "var(--green-bg)", border: "1px solid var(--green)", borderRadius: 8, padding: 16, display: "flex", gap: 12 }}>
        <TrendingUp size={20} color="var(--green)" style={{ flexShrink: 0, marginTop: 2 }} />
        <div>
          <div className="display" style={{ fontSize: 14, color: "var(--green)", fontWeight: 600 }}>
            {belowMinLeads ? "Building your ranking" : "Ranking status"}
          </div>
          <div style={{ fontSize: 12.5, color: "#2E4A38", marginTop: 4, lineHeight: 1.5 }}>
            {belowMinLeads
              ? "New profiles rank on rating and jobs done alone until you've received 10 leads — your conversion rate isn't held against you yet."
              : `Confirming hires as they happen keeps you near the top of search in ${profile.city}. Your ${ratio}% conversion rate factors directly into your ranking.`}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 16, background: "#FBEBD4", border: "1px solid var(--amber)", borderRadius: 8, padding: 16, display: "flex", gap: 12 }}>
        <Award size={20} color="var(--amber-dark)" style={{ flexShrink: 0, marginTop: 2 }} />
        <div>
          <div className="display" style={{ fontSize: 14, color: "var(--amber-dark)", fontWeight: 600 }}>Phase 1 — free for now</div>
          <div style={{ fontSize: 12.5, color: "#5C4213", marginTop: 4, lineHeight: 1.5 }}>
            NearHandsAT is free in {profile.city} while we build up demand. Active pros get first pick of pricing when billing turns on here.
          </div>
        </div>
      </div>

      {pendingConfirmation.length > 0 && (
        <>
          <div className="display" style={{ marginTop: 28, fontSize: 13, color: "var(--steel)", letterSpacing: 1.5, borderBottom: "1px solid var(--line)", paddingBottom: 8 }}>
            AWAITING CLIENT CONFIRMATION
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 14 }}>
            {pendingConfirmation.map((l) => (
              <div key={l.id} className="card" style={{ padding: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ fontWeight: 600, color: "var(--navy)", fontSize: 14 }}>{l.client_name}</div>
                  <Tag>{STATUS_LABEL[l.status]}</Tag>
                </div>
                <div style={{ fontSize: 12, color: "var(--steel)", marginTop: 6, lineHeight: 1.5 }}>
                  If the client hasn't confirmed after a few days, you can self-report the outcome. Unusual patterns get reviewed for fairness.
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button className="btn-secondary" onClick={() => selfReport(l.id, "hired")}>I GOT THIS JOB</button>
                  <button className="btn-secondary" onClick={() => selfReport(l.id, "not_hired")}>DIDN'T GET IT</button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="display" style={{ marginTop: 28, fontSize: 13, color: "var(--steel)", letterSpacing: 1.5, borderBottom: "1px solid var(--line)", paddingBottom: 8 }}>
        ALL LEADS
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14 }}>
        {leads.map((l) => (
          <div key={l.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, padding: "8px 0", borderBottom: "1px solid var(--line)" }}>
            <span>{l.client_name}</span>
            <Tag tone={STATUS_TONE[l.status]}>{STATUS_LABEL[l.status]}</Tag>
          </div>
        ))}
        {leads.length === 0 && <div style={{ fontSize: 13, color: "var(--steel)" }}>No leads yet.</div>}
      </div>

      <div className="display" style={{ marginTop: 28, fontSize: 13, color: "var(--steel)", letterSpacing: 1.5, borderBottom: "1px solid var(--line)", paddingBottom: 8 }}>
        ADD PAST WORK
      </div>
      <form onSubmit={addPortfolio} style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input className="input" style={{ flex: "1 1 160px" }} placeholder="Job title" value={portfolioForm.label} onChange={(e) => setPortfolioForm({ ...portfolioForm, label: e.target.value })} />
        <input className="input" style={{ flex: "1 1 160px" }} placeholder="Short note" value={portfolioForm.note} onChange={(e) => setPortfolioForm({ ...portfolioForm, note: e.target.value })} />
        <button className="btn-primary" style={{ display: "flex", alignItems: "center", gap: 6 }}><Plus size={14} /> ADD</button>
      </form>
      {pfError && <div className="error-text">{pfError}</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 12 }}>
        {profile.portfolio.map((p) => (
          <div key={p.id} style={{ fontSize: 13, color: "#3C3A33" }}>
            <strong style={{ color: "var(--navy)" }}>{p.label}</strong> — {p.note}
          </div>
        ))}
      </div>
    </div>
  );
}
