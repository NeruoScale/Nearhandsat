import React, { useState } from "react";
import { Navigation } from "lucide-react";
import { api } from "../api";

export default function LocationManager({ profile, onSaved }) {
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
      setSaved("City updated.");
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
      setError("Enter a valid distance in km.");
      return;
    }
    try {
      await api.updateProfile({ service_radius_km: value });
      setSaved("Service radius updated.");
      onSaved();
    } catch (err) {
      setError(err.message);
    }
  }

  function shareLocation() {
    setError("");
    setSaved("");
    if (!navigator.geolocation) {
      setError("Location sharing isn't supported in this browser.");
      return;
    }
    setGeoBusy(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          await api.updateProfile({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
          setGeoShared(true);
          setSaved("Location shared.");
          onSaved();
        } catch (err) {
          setError(err.message);
        } finally {
          setGeoBusy(false);
        }
      },
      () => {
        setError("Location permission was denied or unavailable.");
        setGeoBusy(false);
      }
    );
  }

  return (
    <div className="card" style={{ padding: 16 }}>
      <form onSubmit={saveCity} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div style={{ flex: "1 1 200px" }}>
          <label style={{ fontSize: 12, color: "var(--steel)", display: "block", marginBottom: 6 }}>City / area (shown publicly)</label>
          <input className="input" value={city} onChange={(e) => setCity(e.target.value)} placeholder="e.g. Setif" />
        </div>
        <button className="btn-secondary">SAVE CITY</button>
      </form>

      <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--line)" }}>
        <div style={{ fontSize: 12, color: "var(--steel)", lineHeight: 1.5 }}>
          Sharing your precise location is optional and separate from your city above. We use it to support
          radius-based matching in a future update — your exact coordinates are never shown on your public
          profile. You can skip this and rely on your city alone.
        </div>
        <button
          type="button"
          className="btn-secondary"
          style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 6 }}
          onClick={shareLocation}
          disabled={geoBusy}
        >
          <Navigation size={13} /> {geoShared ? "LOCATION SHARED — UPDATE" : "SHARE MY LOCATION"}
        </button>
      </div>

      <form onSubmit={saveRadius} style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--line)", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div style={{ flex: "0 1 180px" }}>
          <label style={{ fontSize: 12, color: "var(--steel)", display: "block", marginBottom: 6 }}>How far will you travel? (km)</label>
          <input className="input" type="number" min="0" value={radius} onChange={(e) => setRadius(e.target.value)} placeholder="e.g. 15" />
        </div>
        <button className="btn-secondary">SAVE RADIUS</button>
      </form>

      {error && <div className="error-text">{error}</div>}
      {saved && !error && <div style={{ fontSize: 12, color: "var(--green)", marginTop: 8 }}>{saved}</div>}
    </div>
  );
}
