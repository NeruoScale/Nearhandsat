import React, { useState } from "react";
import { api, setToken } from "../api";
import { TRADES } from "../constants/trades";
import TradeCombobox from "../components/TradeCombobox";
import LocationPicker from "../components/LocationPicker";

export default function Auth({ onAuth, initialMode = "login", initialRole = "client", compact = false }) {
  const [mode, setMode] = useState(initialMode);
  const [role, setRole] = useState(initialRole);
  const [form, setForm] = useState({ name: "", email: "", password: "", city: "", trade: TRADES[0], bio: "" });
  const [location, setLocation] = useState({ country: "", state: "", city: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (!form.email.trim() || !form.password.trim()) {
      setError("Enter an email and password.");
      return;
    }
    if (mode === "register" && !form.name.trim()) {
      setError("Enter your name.");
      return;
    }
    setBusy(true);
    try {
      const payload =
        role === "artisan"
          ? { ...form, role, city: location.city, country: location.country, state: location.state }
          : { ...form, role };
      const res =
        mode === "login"
          ? await api.login({ email: form.email, password: form.password })
          : await api.register(payload);
      setToken(res.token);
      onAuth(res.user, res.token);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={compact ? undefined : { maxWidth: 380, margin: "60px auto", padding: "0 20px" }}>
      {!compact && (
        <>
          <div className="display" style={{ fontSize: 22, color: "var(--navy)", fontWeight: 600, textAlign: "center" }}>
            NEARHANDS<span style={{ color: "var(--amber)" }}>AT</span>
          </div>
          <div style={{ textAlign: "center", fontSize: 12.5, color: "var(--steel)", marginTop: 4, marginBottom: 24 }}>
            Skilled hands, near you.
          </div>
        </>
      )}

      <div style={{ display: "flex", gap: 4, background: "var(--card)", border: "1px solid var(--line)", borderRadius: 6, padding: 3, marginBottom: 20 }}>
        <button
          onClick={() => setMode("login")}
          className="display"
          style={{ flex: 1, padding: "8px 0", borderRadius: 5, border: "none", fontSize: 12, fontWeight: 600, background: mode === "login" ? "var(--navy)" : "transparent", color: mode === "login" ? "var(--chalk)" : "var(--steel)" }}
        >
          SIGN IN
        </button>
        <button
          onClick={() => setMode("register")}
          className="display"
          style={{ flex: 1, padding: "8px 0", borderRadius: 5, border: "none", fontSize: 12, fontWeight: 600, background: mode === "register" ? "var(--navy)" : "transparent", color: mode === "register" ? "var(--chalk)" : "var(--steel)" }}
        >
          CREATE ACCOUNT
        </button>
      </div>

      <form onSubmit={submit}>
        {mode === "register" && (
          <>
            <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
              <button type="button" onClick={() => setRole("client")} className="btn-secondary" style={{ flex: 1, background: role === "client" ? "var(--chalk)" : "transparent", borderColor: role === "client" ? "var(--navy)" : "var(--line)" }}>
                I NEED WORK DONE
              </button>
              <button type="button" onClick={() => setRole("artisan")} className="btn-secondary" style={{ flex: 1, background: role === "artisan" ? "var(--chalk)" : "transparent", borderColor: role === "artisan" ? "var(--navy)" : "var(--line)" }}>
                I DO THE WORK
              </button>
            </div>
            <input className="input" placeholder="Full name" value={form.name} onChange={set("name")} style={{ marginBottom: 10 }} />
          </>
        )}
        <input className="input" placeholder="Email" value={form.email} onChange={set("email")} style={{ marginBottom: 10 }} />
        <input className="input" type="password" placeholder="Password" value={form.password} onChange={set("password")} style={{ marginBottom: 10 }} />
        {mode === "register" && role === "client" && (
          <input className="input" placeholder="City" value={form.city} onChange={set("city")} style={{ marginBottom: 10 }} />
        )}
        {mode === "register" && role === "artisan" && (
          <>
            <div style={{ marginBottom: 10 }}>
              <LocationPicker value={location} onChange={setLocation} />
            </div>
            <div style={{ marginBottom: 10 }}>
              <TradeCombobox value={form.trade} onChange={(v) => setForm({ ...form, trade: v })} placeholder="Trade" />
            </div>
            <textarea className="input" placeholder="Short bio — what you do and your experience" value={form.bio} onChange={set("bio")} style={{ marginBottom: 10, minHeight: 70, resize: "vertical" }} />
          </>
        )}
        {error && <div className="error-text">{error}</div>}
        <button className="btn-primary" style={{ width: "100%", marginTop: 6, padding: "11px 0" }} disabled={busy}>
          {mode === "login" ? "SIGN IN" : "CREATE ACCOUNT"}
        </button>
      </form>

      {!compact && (
        <div style={{ marginTop: 18, fontSize: 11.5, color: "var(--steel)", textAlign: "center", lineHeight: 1.6 }}>
          Demo accounts (password: password123):<br />
          client1@example.com · artisan1@example.com · admin@nearhandsat.com
        </div>
      )}
    </div>
  );
}
