import React, { useState } from "react";
import { Wrench, LogOut } from "lucide-react";
import { setToken } from "./api";
import Auth from "./pages/Auth";
import Search from "./pages/Search";
import Profile from "./pages/Profile";
import MyLeads from "./pages/MyLeads";
import ArtisanDashboard from "./pages/ArtisanDashboard";
import AdminDashboard from "./pages/AdminDashboard";

export default function App() {
  const [user, setUser] = useState(null);
  const [tab, setTab] = useState("search");
  const [selectedArtisan, setSelectedArtisan] = useState(null);

  function onAuth(u, token) {
    setUser(u);
    setToken(token);
    setTab(u.role === "admin" ? "admin" : u.role === "artisan" ? "dashboard" : "search");
  }

  function signOut() {
    setUser(null);
    setToken(null);
    setSelectedArtisan(null);
  }

  if (!user) return <Auth onAuth={onAuth} />;

  const clientTabs = [
    ["search", "FIND A PRO"],
    ["leads", "YOUR REQUESTS"],
  ];
  const artisanTabs = [["dashboard", "DASHBOARD"]];
  const adminTabs = [["admin", "ADMIN"]];
  const tabs = user.role === "admin" ? adminTabs : user.role === "artisan" ? artisanTabs : clientTabs;

  return (
    <div style={{ minHeight: "100vh" }}>
      <div style={{ background: "var(--navy)", padding: "14px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 30, height: 30, background: "var(--amber)", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Wrench size={16} color="var(--navy)" />
          </div>
          <div className="display" style={{ fontSize: 18, color: "var(--chalk)", fontWeight: 600 }}>
            NEARHANDS<span style={{ color: "var(--amber)" }}>AT</span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ display: "flex", gap: 4, background: "var(--navy-light)", borderRadius: 6, padding: 3 }}>
            {tabs.map(([key, label]) => (
              <button
                key={key}
                onClick={() => { setTab(key); setSelectedArtisan(null); }}
                className="display"
                style={{
                  padding: "7px 14px",
                  borderRadius: 5,
                  border: "none",
                  fontSize: 12,
                  fontWeight: 600,
                  letterSpacing: 0.5,
                  background: tab === key ? "var(--amber)" : "transparent",
                  color: tab === key ? "#2A1B04" : "#C7CEDD",
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <button onClick={signOut} style={{ background: "none", border: "none", color: "#C7CEDD", display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}>
            <LogOut size={14} /> {user.name.split(" ")[0]}
          </button>
        </div>
      </div>

      <div style={{ maxWidth: 780, margin: "0 auto", padding: "24px 20px 60px" }}>
        {tab === "search" && !selectedArtisan && <Search onSelect={setSelectedArtisan} />}
        {tab === "search" && selectedArtisan && (
          <Profile artisanId={selectedArtisan} onBack={() => setSelectedArtisan(null)} />
        )}
        {tab === "leads" && <MyLeads />}
        {tab === "dashboard" && <ArtisanDashboard user={user} />}
        {tab === "admin" && <AdminDashboard />}
      </div>
    </div>
  );
}
