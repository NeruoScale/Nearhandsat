import React, { useEffect, useState } from "react";
import { Wrench, Search, Star, MessageCircle, CheckCircle2, UserPlus, Image, Users, TrendingUp, Download, X } from "lucide-react";
import { useLanguage, translations } from "../i18n";

const LANGS = Object.keys(translations);

function InstallBanner() {
  const [installEvent, setInstallEvent] = useState(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    function onBeforeInstallPrompt(e) {
      e.preventDefault();
      setInstallEvent(e);
    }
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
  }, []);

  if (!installEvent || dismissed) return null;

  async function install() {
    installEvent.prompt();
    await installEvent.userChoice;
    setInstallEvent(null);
  }

  return (
    <div
      style={{
        position: "fixed",
        bottom: 16,
        insetInlineStart: "50%",
        transform: "translateX(-50%)",
        zIndex: 15,
        background: "var(--navy)",
        color: "var(--chalk)",
        borderRadius: 8,
        padding: "10px 10px 10px 16px",
        display: "flex",
        alignItems: "center",
        gap: 10,
        fontSize: 12.5,
        boxShadow: "0 6px 20px rgba(0,0,0,0.25)",
        maxWidth: "calc(100vw - 32px)",
      }}
    >
      <span>Install NearHandsAT for quick access</span>
      <button onClick={install} className="btn-primary" style={{ padding: "6px 12px", fontSize: 11, display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
        <Download size={12} /> INSTALL
      </button>
      <button onClick={() => setDismissed(true)} style={{ background: "none", border: "none", color: "var(--chalk)", cursor: "pointer", display: "flex", flexShrink: 0, padding: 2 }}>
        <X size={14} />
      </button>
    </div>
  );
}

function LanguageSwitcher() {
  const { lang, setLang } = useLanguage();
  return (
    <div
      style={{
        position: "fixed",
        top: 16,
        insetInlineStart: 16,
        zIndex: 10,
        display: "flex",
        gap: 4,
        background: "var(--card)",
        border: "1px solid var(--line)",
        borderRadius: 6,
        padding: 3,
      }}
    >
      {LANGS.map((code) => (
        <button
          key={code}
          onClick={() => setLang(code)}
          className="display"
          style={{
            padding: "6px 10px",
            borderRadius: 5,
            border: "none",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: 0.5,
            background: lang === code ? "var(--navy)" : "transparent",
            color: lang === code ? "var(--chalk)" : "var(--steel)",
          }}
        >
          {translations[code].langName}
        </button>
      ))}
    </div>
  );
}

function StepColumn({ title, steps, icons }) {
  return (
    <div className="card" style={{ padding: 20 }}>
      <div className="display" style={{ fontSize: 15, color: "var(--navy)", fontWeight: 600, marginBottom: 14 }}>{title}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {steps.map((step, i) => {
          const Icon = icons[i];
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 8,
                  background: "var(--navy)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <Icon size={16} color="var(--chalk)" />
              </div>
              <div style={{ fontSize: 13.5, color: "#3C3A33", lineHeight: 1.4 }}>{step}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function Landing({ onBrowse, onProfessional, onSignIn }) {
  const { t } = useLanguage();

  return (
    <div style={{ minHeight: "100vh" }}>
      <LanguageSwitcher />
      <InstallBanner />

      <div style={{ maxWidth: 780, margin: "0 auto", padding: "80px 20px 60px", textAlign: "center" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 18 }}>
          <div style={{ width: 34, height: 34, background: "var(--amber)", borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Wrench size={18} color="var(--navy)" />
          </div>
          <div className="display" style={{ fontSize: 22, color: "var(--navy)", fontWeight: 600 }}>
            {t.hero.title}<span style={{ color: "var(--amber)" }}>{t.hero.titleAccent}</span>
          </div>
        </div>

        <div className="display" style={{ fontSize: 14, color: "var(--amber-dark)", fontWeight: 600, letterSpacing: 0.5 }}>
          {t.hero.tagline}
        </div>

        <div
          className="display"
          style={{
            fontSize: "clamp(28px, 6vw, 44px)",
            lineHeight: 1.15,
            color: "var(--navy)",
            fontWeight: 700,
            marginTop: 14,
            maxWidth: 680,
            marginInline: "auto",
          }}
        >
          {t.hero.headline}
        </div>

        <div style={{ fontSize: 15, color: "var(--steel)", lineHeight: 1.6, marginTop: 18, maxWidth: 560, marginInline: "auto" }}>
          {t.hero.subhead}
        </div>
      </div>

      <div style={{ maxWidth: 780, margin: "0 auto", padding: "0 20px" }}>
        <div className="display" style={{ fontSize: 13, color: "var(--steel)", letterSpacing: 1.5, textAlign: "center", marginBottom: 18 }}>
          {t.howItWorks.title.toUpperCase()}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
          <StepColumn
            title={t.howItWorks.clientTab}
            steps={t.howItWorks.clientSteps}
            icons={[Search, Star, MessageCircle, CheckCircle2]}
          />
          <StepColumn
            title={t.howItWorks.proTab}
            steps={t.howItWorks.proSteps}
            icons={[UserPlus, Image, Users, TrendingUp]}
          />
        </div>

        <div style={{ textAlign: "center", fontSize: 12, color: "var(--steel)", marginTop: 24 }}>
          {t.trustLine}
        </div>

        <div style={{ display: "flex", gap: 12, marginTop: 32, flexWrap: "wrap", justifyContent: "center" }}>
          <button className="btn-primary" style={{ flex: "1 1 220px", padding: "14px 0" }} onClick={onBrowse}>
            {t.cta.client.toUpperCase()}
          </button>
          <button className="btn-secondary" style={{ flex: "1 1 220px", padding: "14px 0" }} onClick={onProfessional}>
            {t.cta.professional.toUpperCase()}
          </button>
        </div>

        <div style={{ textAlign: "center", marginTop: 20, paddingBottom: 40 }}>
          <button onClick={onSignIn} style={{ background: "none", border: "none", color: "var(--steel)", fontSize: 13, textDecoration: "underline", cursor: "pointer" }}>
            {t.signIn}
          </button>
        </div>
      </div>
    </div>
  );
}
