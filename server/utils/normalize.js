// README roadmap #7A, Phase D: normalization utilities for candidate
// discovery/deduplication/NearHandsAT-identity matching. Country-agnostic
// throughout -- no field here assumes a specific country's phone plan,
// address format, or naming convention.
//
// Text/diacritic normalization is NOT reimplemented here -- it reuses
// server/utils/geo.js's existing normalize() (already NFD-diacritic- and
// case-insensitive, already proven against this app's real location data)
// rather than duplicating that logic.
const { normalize: normalizeText, resolveLocation } = require("./geo");
const { TRADES } = require("../constants/trades");

// Matches free text against the existing TRADES list (== categories.code)
// via normalizeText() equality. Returns the exact TRADES string on a match,
// or null -- this NEVER guesses a "closest" category. A discovery source
// whose category text doesn't cleanly match one of the 25 trades stays
// uncategorized (candidates.category_code nullable) rather than being
// silently misfiled.
const TRADE_BY_NORMALIZED = new Map(TRADES.map((t) => [normalizeText(t), t]));
function normalizeCategory(rawCategory) {
  if (!rawCategory) return null;
  return TRADE_BY_NORMALIZED.get(normalizeText(rawCategory)) || null;
}

// Normalizes a name for comparison purposes only (dedup/matching keys) --
// the original, human-readable string is always kept separately
// (candidates.display_name) and never overwritten by this. Collapses
// internal whitespace on top of geo.js's normalizeText(), which only
// trims -- for place names (normalizeText's original use) that's enough,
// but two business names differing only in inconsistent internal spacing
// ("Karim  Ferhat" vs "Karim Ferhat") must compare equal here.
function normalizeName(rawName) {
  const n = normalizeText(rawName).replace(/\s+/g, " ");
  return n || null;
}

// Best-effort phone normalization with no country-specific parsing table
// (no phone-numbering-plan library is part of this app, and adding one is
// out of scope for #7A). Strips formatting punctuation/whitespace; a
// leading "00" (the near-universal international-dialing prefix
// convention) becomes "+"; anything already starting with "+" is kept
// as-is. Does NOT infer a country code for a number that has neither --
// two candidates with the same local-format digits but unknown/different
// countries must never be treated as equal by this alone. Returns null for
// anything that isn't recognizably a phone number (too short, no digits).
function normalizePhone(rawPhone) {
  if (!rawPhone) return null;
  let cleaned = String(rawPhone).replace(/[\s().-]/g, "");
  if (!cleaned) return null;
  if (cleaned.startsWith("00")) cleaned = `+${cleaned.slice(2)}`;
  const digits = cleaned.replace(/^\+/, "");
  if (!/^\d{6,15}$/.test(digits)) return null;
  return cleaned.startsWith("+") ? `+${digits}` : digits;
}

// Extracts a comparable domain from a website/URL string: lowercase host,
// "www." stripped, no scheme/path/query. Uses the built-in URL parser
// (no new dependency). Returns null for anything unparsable.
function normalizeWebsiteDomain(rawUrl) {
  if (!rawUrl) return null;
  let candidate = String(rawUrl).trim();
  if (!candidate) return null;
  if (!/^https?:\/\//i.test(candidate)) candidate = `http://${candidate}`;
  try {
    const host = new URL(candidate).hostname.toLowerCase();
    return host.startsWith("www.") ? host.slice(4) : host || null;
  } catch {
    return null;
  }
}

// Thin, explicit wrapper so callers normalizing a candidate's free-text
// location don't need to import geo.js directly just for this -- resolves
// to { lat, lng } using the exact same country/state/city dataset the rest
// of the app already relies on, or null when it can't be resolved (never a
// guessed fallback).
function normalizeLocation({ country, state, city, latitude, longitude } = {}) {
  return resolveLocation({ country, state, city, latitude, longitude });
}

module.exports = {
  normalizeText,
  normalizeCategory,
  normalizeName,
  normalizePhone,
  normalizeWebsiteDomain,
  normalizeLocation,
};
