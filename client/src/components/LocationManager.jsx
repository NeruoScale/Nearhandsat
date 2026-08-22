import React, { useState } from "react";
import { Navigation } from "lucide-react";
import { api } from "../api";
import { useLanguage } from "../i18n";

export default function LocationManager({ profile, onSaved }) {
  const { t } = useLanguage();
  const [city, setCity] = useState(profile.city || "");
  const [radius, setRadius] = useState(profile.service_radius_km ?? "");
  const [geoBusy, setGeoBusy] = useState(false);
  const [geoShared, setGeoShared] = useState(!!profile.latitude);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  async function saveCity(e) {
    e.preventDefault();
    setError("");
    setSaved("");
    try {
      await api.updateProfile({ city });
      setSaved(t.location.cityUpdated);
      onSaved();
    } catch (err) {
      setError(err.message);
    }
  }

  async function saveRadius(e) {
    e.preventDefault();
    setError("");
    setSaved("");
    const value = radius === "" ? null : parseInt(radius, 10);
    if (value !== null && (Number.isNaN(value) || value < 0)) {
      setError(t.location.invalidDistance);
      return;
    }
    try {
      await api.updateProfile({ service_radius_km: value });
      setSaved(t.location.radiusUpdated);
      onSaved();
    } catch (err) {
      setError(err.message);
    }
  }

  function shareLocation() {
    setError("");
    setSaved("");
    if (!navigator.geolocation) {
      setError(t.location.notSupported);
      return;
    }
    setGeoBusy(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          await api.updateProfile({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
          setGeoShared(true);
          setSaved(t.location.locationShared);
          onSaved();
        } catch (err) {
          setError(err.message);
        } finally {
          setGeoBusy(false);
        }
      },
      () => {
        setError(t.location.permissionDenied);
        setGeoBusy(false);
      }
    );
  }

  return (
    <div className="card" style={{ padding: 16 }}>
      <form onSubmit={saveCity} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div style={{ flex: "1 1 200px" }}>
          <label style={{ fontSize: 12, color: "var(--steel)", display: "block", marginBottom: 6 }}>{t.location.cityLabel}</label>
          <input className="input" value={city} onChange={(e) => setCity(e.target.value)} placeholder={t.location.cityPlaceholder} />
        </div>
        <button className="btn-secondary">{t.location.saveCity}</button>
      </form>

      <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--line)" }}>
        <div style={{ fontSize: 12, color: "var(--steel)", lineHeight: 1.5 }}>
          {t.location.shareDesc}
        </div>
        <button
          type="button"
          className="btn-secondary"
          style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 6 }}
          onClick={shareLocation}
          disabled={geoBusy}
        >
          <Navigation size={13} /> {geoShared ? t.location.locationSharedUpdate : t.location.shareLocation}
        </button>
      </div>

      <form onSubmit={saveRadius} style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--line)", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div style={{ flex: "0 1 180px" }}>
          <label style={{ fontSize: 12, color: "var(--steel)", display: "block", marginBottom: 6 }}>{t.location.radiusLabel}</label>
          <input className="input" type="number" min="0" value={radius} onChange={(e) => setRadius(e.target.value)} placeholder={t.location.radiusPlaceholder} />
        </div>
        <button className="btn-secondary">{t.location.saveRadius}</button>
      </form>

      {error && <div className="error-text">{error}</div>}
      {saved && !error && <div style={{ fontSize: 12, color: "var(--green)", marginTop: 8 }}>{saved}</div>}
    </div>
  );
}
