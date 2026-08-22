import React, { useEffect, useMemo, useState } from "react";
import { Search as SearchIcon, Users, X } from "lucide-react";
import { api } from "../api";
import { WorkTag } from "../components/Shared";
import TradeCombobox from "../components/TradeCombobox";
import LocationPicker from "../components/LocationPicker";
import { useLanguage } from "../i18n";

const PAGE_SIZE = 20;
const EMPTY_LOCATION = { country: "", state: "", city: "" };

export default function Search({ onSelect }) {
  const { t } = useLanguage();
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [location, setLocation] = useState(EMPTY_LOCATION);
  const [minRating, setMinRating] = useState(0);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  function buildParams(offset) {
    const params = { limit: PAGE_SIZE, offset };
    if (q) params.q = q;
    if (category) params.category = category;
    if (location.country) params.country = location.country;
    if (location.state) params.state = location.state;
    if (location.city) params.city = location.city;
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
  }, [q, category, location, minRating]);

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
            placeholder={t.search.placeholder}
            style={{ border: "none", outline: "none", background: "transparent", flex: 1, fontSize: 14 }}
          />
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center", width: 200 }}>
          <div style={{ flex: 1 }}>
            <TradeCombobox value={category} onChange={setCategory} placeholder={t.search.allCategories} />
          </div>
          {category && (
            <button type="button" className="btn-secondary" style={{ padding: "9px 10px", flexShrink: 0 }} onClick={() => setCategory("")} title={t.search.clearCategory}>
              <X size={13} />
            </button>
          )}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "flex-start", width: 260 }}>
          <div style={{ flex: 1 }}>
            <LocationPicker value={location} onChange={setLocation} />
          </div>
          {(location.country || location.state || location.city) && (
            <button
              type="button"
              className="btn-secondary"
              style={{ padding: "9px 10px", flexShrink: 0 }}
              onClick={() => setLocation(EMPTY_LOCATION)}
              title={t.search.clearLocation}
            >
              <X size={13} />
            </button>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--steel)" }}>
          {t.search.minRating}
          <input type="range" min="0" max="5" step="0.5" value={minRating} onChange={(e) => setMinRating(parseFloat(e.target.value))} />
          <span className="mono" style={{ width: 24 }}>{minRating.toFixed(1)}</span>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 16, color: "var(--steel)", fontSize: 12.5 }}>
        <Users size={13} /> {loading ? t.search.searching : t.search.resultsCount(rows.length, total)}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14, marginTop: 12 }}>
        {rows.map((a) => (
          <WorkTag key={a.id} artisan={a} onClick={() => onSelect(a.id)} />
        ))}
      </div>

      {!loading && rows.length < total && (
        <div style={{ textAlign: "center", marginTop: 20 }}>
          <button className="btn-secondary" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? t.search.loadingMore : t.search.loadMore}
          </button>
        </div>
      )}
    </div>
  );
}
