import React from "react";
import { Star, CheckCircle2, MapPin, Zap, Wrench, Hammer, PaintBucket } from "lucide-react";
import { useLanguage } from "../i18n";

export const ICONS = { Electrician: Zap, Plumber: Wrench, Carpenter: Hammer, Painter: PaintBucket };

export function formatLocation({ city, state, country }) {
  return [city, state, country].filter(Boolean).join(", ");
}

export function Tag({ children, tone = "steel" }) {
  const tones = {
    steel: { bg: "#EAE7DC", fg: "var(--steel)" },
    green: { bg: "#E3EEE7", fg: "var(--green)" },
    amber: { bg: "#FBEBD4", fg: "var(--amber-dark)" },
  };
  const t = tones[tone];
  return (
    <span
      className="mono"
      style={{
        background: t.bg,
        color: t.fg,
        fontSize: 11,
        padding: "3px 8px",
        borderRadius: 4,
        letterSpacing: 0.3,
        fontWeight: 600,
      }}
    >
      {children}
    </span>
  );
}

export function Gauge({ value, max = 100, size = 84 }) {
  const { t } = useLanguage();
  const pct = Math.min(1, max ? value / max : 0);
  const r = size / 2 - 8;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth="7" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--amber)"
        strokeWidth="7"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - pct)}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x="50%" y="47%" textAnchor="middle" className="mono" fontSize="18" fontWeight="600" fill="var(--navy)">
        {value}
      </text>
      <text x="50%" y="64%" textAnchor="middle" className="mono" fontSize="8" fill="var(--steel)" letterSpacing="1">
        {t.shared.jobsLabel}
      </text>
    </svg>
  );
}

export function WorkTag({ artisan, onClick }) {
  const { t } = useLanguage();
  const Icon = ICONS[artisan.trade] || Hammer;
  const ratio =
    artisan.conversion_ratio !== null && artisan.conversion_ratio !== undefined
      ? Math.round(artisan.conversion_ratio * 100)
      : null;
  return (
    <div
      onClick={onClick}
      className="card"
      style={{ position: "relative", padding: "18px 18px 16px 26px", cursor: "pointer" }}
    >
      <div
        style={{
          position: "absolute",
          left: -1,
          top: 0,
          bottom: 0,
          width: 14,
          backgroundImage: "radial-gradient(circle at 7px 10px, var(--chalk) 5px, transparent 5.5px)",
          backgroundSize: "14px 20px",
          backgroundRepeat: "repeat-y",
          borderRight: "1px dashed var(--line)",
        }}
      />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div
            style={{
              width: 30,
              height: 30,
              borderRadius: 6,
              background: "var(--navy)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Icon size={16} color="var(--chalk)" />
          </div>
          <div>
            <div className="display" style={{ fontSize: 16, color: "var(--navy)", fontWeight: 600 }}>
              {artisan.name}
            </div>
            <div style={{ fontSize: 12, color: "var(--steel)", display: "flex", alignItems: "center", gap: 4 }}>
              <MapPin size={11} />
              {formatLocation(artisan)} · {artisan.trade}
            </div>
          </div>
        </div>
        {artisan.jobs_completed >= 15 && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 3,
              border: "1.5px solid var(--green)",
              borderRadius: 4,
              padding: "2px 6px",
              flexShrink: 0,
            }}
          >
            <CheckCircle2 size={11} color="var(--green)" />
            <span className="display" style={{ fontSize: 10, color: "var(--green)", fontWeight: 600 }}>
              {t.profile.verified.toUpperCase()}
            </span>
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 12, flexWrap: "wrap" }}>
        <Tag tone="amber">
          <Star size={10} style={{ verticalAlign: -1, marginRight: 3 }} />
          {Number(artisan.avg_rating).toFixed(1)}
        </Tag>
        <Tag>{artisan.jobs_completed} {t.shared.jobsDone}</Tag>
        {ratio !== null && <Tag tone={ratio >= 60 ? "green" : "steel"}>{ratio}% convert</Tag>}
      </div>
      <div style={{ marginTop: 12, fontSize: 13, color: "#3C3A33", lineHeight: 1.5 }}>{artisan.bio}</div>
    </div>
  );
}

// Roadmap #3: a service search result. Deliberately styled after WorkTag
// rather than sharing its markup -- a service card leads with its own
// title/price, the professional is secondary context here, the reverse of
// WorkTag's professional-first framing.
export function ServiceTag({ service, onClick }) {
  const { t } = useLanguage();
  const Icon = ICONS[service.category] || Hammer;
  const price =
    service.pricing_model === "quote"
      ? t.services.contactForQuote
      : service.pricing_model === "starting_at"
      ? t.services.startingFrom(service.price, service.currency)
      : t.services.fixedPrice(service.price, service.currency);
  return (
    <div onClick={onClick} className="card" style={{ padding: "16px 18px", cursor: "pointer" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div
          style={{
            width: 30, height: 30, borderRadius: 6, background: "var(--navy)",
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}
        >
          <Icon size={16} color="var(--chalk)" />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="display" style={{ fontSize: 15, color: "var(--navy)", fontWeight: 600 }}>{service.title}</div>
          <div style={{ fontSize: 12, color: "var(--steel)", display: "flex", alignItems: "center", gap: 4 }}>
            <MapPin size={11} />
            {formatLocation(service)} · {t.services.byArtisan(service.artisan_name)}
          </div>
        </div>
      </div>
      <div style={{ marginTop: 10, fontSize: 13, color: "#3C3A33", lineHeight: 1.5 }}>{service.description}</div>
      <div style={{ marginTop: 10 }}>
        <Tag tone="amber">{price}</Tag>
      </div>
    </div>
  );
}

export function Modal({ children, onClose }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(30,42,69,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{ maxWidth: 440, width: "100%", maxHeight: "85vh", overflowY: "auto", padding: 24, position: "relative" }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
