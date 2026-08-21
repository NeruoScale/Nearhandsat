import React, { useEffect, useMemo, useState } from "react";
import { Search as SearchIcon, Users } from "lucide-react";
import { api } from "../api";
import { WorkTag } from "../components/Shared";

const TRADES = ["All", "Electrician", "Plumber", "Carpenter", "Painter"];
const CITIES = ["All", "Setif", "El Eulma"];

export default function Search({ onSelect }) {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("All");
  const [city, setCity] = useState("All");
  const [minRating, setMinRating] = useState(0);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const params = {};
    if (q) params.q = q;
    if (category !== "All") params.category = category;
    if (city !== "All") params.city = city;
    if (minRating) params.minRating = minRating;
    const t = setTimeout(() => {
      api.searchArtisans(params).then(setRows).finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(t);
  }, [q, category, city, minRating]);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }} className="card">
        <div style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: 8, width: "100%" }}>
          <SearchIcon size={16} color="var(--steel)" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by trade, name, or city"
            style={{ border: "none", outline: "none", background: "transparent", flex: 1, fontSize: 14 }}
          />
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
        <select className="input" style={{ width: "auto" }} value={category} onChange={(e) => setCategory(e.target.value)}>
          {TRADES.map((t) => <option key={t}>{t}</option>)}
        </select>
        <select className="input" style={{ width: "auto" }} value={city} onChange={(e) => setCity(e.target.value)}>
          {CITIES.map((c) => <option key={c}>{c}</option>)}
        </select>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--steel)" }}>
          Min rating
          <input type="range" min="0" max="5" step="0.5" value={minRating} onChange={(e) => setMinRating(parseFloat(e.target.value))} />
          <span className="mono" style={{ width: 24 }}>{minRating.toFixed(1)}</span>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 16, color: "var(--steel)", fontSize: 12.5 }}>
        <Users size={13} /> {loading ? "Searching…" : `${rows.length} pro${rows.length !== 1 ? "s" : ""} found`}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14, marginTop: 12 }}>
        {rows.map((a) => (
          <WorkTag key={a.id} artisan={a} onClick={() => onSelect(a.id)} />
        ))}
      </div>
    </div>
  );
}
