import React, { useEffect, useMemo, useState } from "react";
import { Search as SearchIcon, Users } from "lucide-react";
import { api } from "../api";
import { WorkTag } from "../components/Shared";

const TRADES = ["All", "Electrician", "Plumber", "Carpenter", "Painter"];
const CITIES = ["All", "Setif", "El Eulma"];
const PAGE_SIZE = 20;

export default function Search({ onSelect }) {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("All");
  const [city, setCity] = useState("All");
  const [minRating, setMinRating] = useState(0);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  function buildParams(offset) {
    const params = { limit: PAGE_SIZE, offset };
    if (q) params.q = q;
    if (category !== "All") params.category = category;
    if (city !== "All") params.city = city;
    if (minRating) params.minRating = minRating;
    return params;
  }

  useEffect(() => {
    setLoading(true);
    const t = setTimeout(() => {
      api
        .searchArtisans(buildParams(0))
        .then((res) => {
          setRows(res.results);
          setTotal(res.total);
        })
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(t);
  }, [q, category, city, minRating]);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const res = await api.searchArtisans(buildParams(rows.length));
      setRows((prev) => [...prev, ...res.results]);
      setTotal(res.total);
    } finally {
      setLoadingMore(false);
    }
  }

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
        <Users size={13} /> {loading ? "Searching…" : `${rows.length} of ${total} pro${total !== 1 ? "s" : ""} found`}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14, marginTop: 12 }}>
        {rows.map((a) => (
          <WorkTag key={a.id} artisan={a} onClick={() => onSelect(a.id)} />
        ))}
      </div>

      {!loading && rows.length < total && (
        <div style={{ textAlign: "center", marginTop: 20 }}>
          <button className="btn-secondary" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? "LOADING…" : "LOAD MORE"}
          </button>
        </div>
      )}
    </div>
  );
}
