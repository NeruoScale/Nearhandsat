import React, { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { api } from "../api";
import { Tag } from "../components/Shared";

const FLAGGED_PAGE_SIZE = 25;

export default function AdminDashboard() {
  const [stats, setStats] = useState(null);
  const [flagged, setFlagged] = useState([]);
  const [flaggedTotal, setFlaggedTotal] = useState(0);
  const [billing, setBilling] = useState([]);

  function load() {
    api.adminStats().then(setStats);
    api.adminFlagged({ limit: FLAGGED_PAGE_SIZE, offset: 0 }).then((res) => {
      setFlagged(res.results);
      setFlaggedTotal(res.total);
    });
    api.adminBilling().then(setBilling);
  }
  useEffect(load, []);

  async function loadMoreFlagged() {
    const res = await api.adminFlagged({ limit: FLAGGED_PAGE_SIZE, offset: flagged.length });
    setFlagged((prev) => [...prev, ...res.results]);
    setFlaggedTotal(res.total);
  }

  async function togglePaid(row) {
    await api.updateBilling(row.id, { paid_mode: row.paid_mode ? 0 : 1 });
    load();
  }

  if (!stats) return <div style={{ padding: 40, textAlign: "center", color: "var(--steel)" }}>Loading…</div>;

  return (
    <div>
      <div className="display" style={{ fontSize: 22, color: "var(--navy)", fontWeight: 600 }}>Admin</div>
      <div style={{ fontSize: 13, color: "var(--steel)", marginTop: 2 }}>Platform-wide stats and controls.</div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 12, marginTop: 20 }}>
        {[
          ["CLIENTS", stats.totals.clients],
          ["ARTISANS", stats.totals.artisans],
          ["LEADS", stats.totals.leads],
          ["HIRES", stats.totals.hires],
          ["CONVERSION", `${stats.totals.conversion_rate}%`],
        ].map(([label, value]) => (
          <div key={label} className="card" style={{ padding: 14 }}>
            <div style={{ fontSize: 10.5, color: "var(--steel)", letterSpacing: 0.5 }}>{label}</div>
            <div className="mono" style={{ fontSize: 22, color: "var(--navy)", marginTop: 4 }}>{value}</div>
          </div>
        ))}
      </div>

      <div className="display" style={{ marginTop: 28, fontSize: 13, color: "var(--steel)", letterSpacing: 1.5, borderBottom: "1px solid var(--line)", paddingBottom: 8 }}>
        CONVERSION BY CATEGORY / CITY
      </div>
      <div style={{ marginTop: 12, overflowX: "auto" }}>
        <table style={{ width: "100%", fontSize: 12.5, borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", color: "var(--steel)" }}>
              <th style={{ padding: "6px 8px" }}>City</th>
              <th style={{ padding: "6px 8px" }}>Category</th>
              <th style={{ padding: "6px 8px" }}>Leads</th>
              <th style={{ padding: "6px 8px" }}>Hires</th>
              <th style={{ padding: "6px 8px" }}>Conversion</th>
            </tr>
          </thead>
          <tbody>
            {stats.byCategory.map((r, i) => (
              <tr key={i} style={{ borderTop: "1px solid var(--line)" }}>
                <td style={{ padding: "6px 8px" }}>{r.city}</td>
                <td style={{ padding: "6px 8px" }}>{r.category}</td>
                <td style={{ padding: "6px 8px" }}>{r.leads}</td>
                <td style={{ padding: "6px 8px" }}>{r.hires}</td>
                <td style={{ padding: "6px 8px" }}>{r.conversion_rate}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="display" style={{ marginTop: 28, fontSize: 13, color: "var(--steel)", letterSpacing: 1.5, borderBottom: "1px solid var(--line)", paddingBottom: 8 }}>
        FLAGGED FOR REVIEW
      </div>
      <div style={{ fontSize: 12, color: "var(--steel)", marginTop: 8 }}>
        High lead volume but unusually low confirmed-hire ratio (under 20%, min. 10 leads). Informational only — not an automatic penalty.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
        {flagged.map((f) => (
          <div key={f.id} className="card" style={{ padding: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <AlertTriangle size={15} color="var(--amber-dark)" />
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--navy)" }}>{f.name}</div>
                <div style={{ fontSize: 11.5, color: "var(--steel)" }}>{f.trade}, {f.city}</div>
              </div>
            </div>
            <Tag tone="amber">{f.ratio}% of {f.leads_received} leads</Tag>
          </div>
        ))}
        {flagged.length === 0 && <div style={{ fontSize: 13, color: "var(--steel)" }}>Nothing flagged right now.</div>}
      </div>
      {flagged.length < flaggedTotal && (
        <div style={{ textAlign: "center", marginTop: 12 }}>
          <button className="btn-secondary" onClick={loadMoreFlagged}>LOAD MORE</button>
        </div>
      )}

      <div className="display" style={{ marginTop: 28, fontSize: 13, color: "var(--steel)", letterSpacing: 1.5, borderBottom: "1px solid var(--line)", paddingBottom: 8 }}>
        BILLING BY SEGMENT
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
        {billing.map((b) => (
          <div key={b.id} className="card" style={{ padding: 12, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <div style={{ fontSize: 13 }}>
              <strong style={{ color: "var(--navy)" }}>{b.city}</strong> · {b.category}
              <span style={{ color: "var(--steel)", marginLeft: 8 }}>
                {b.free_lead_limit} free leads, then ${b.price_per_lead}/lead or ${b.subscription_price}/mo
              </span>
            </div>
            <button className="btn-secondary" onClick={() => togglePaid(b)}>
              {b.paid_mode ? "PAID MODE: ON" : "PAID MODE: OFF"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
