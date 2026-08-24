// README roadmap #7A, Phase F: NearHandsAT-identity matching.
//
// Checks whether a candidate (externally discovered) might already be a
// real, registered NearHandsAT user -- so the future acquisition workflow
// (out of #7A's scope) doesn't invite someone who's already on the
// platform. This module is READ-ONLY: it never creates, deletes, or
// modifies a candidate or a user. It only reports what it found; the
// caller (the ingestion pipeline, Phase H) is responsible for recording
// the result as a candidate_events row (event_type 'identity_match_found',
// with { matched_user_id, signals, confidence } in `detail`) -- never as a
// live foreign key from candidates to users.
//
// Signal coverage is intentionally limited to what the existing schema
// actually stores: users.phone (Phase B) and users.email are compared
// directly; name+location+trade is a probable (never sole-basis) signal.
// Website-based matching is NOT implemented here -- artisan_profiles has
// no website column today, so there is nothing on the NearHandsAT side to
// compare a candidate's website_domain against. Adding one is out of scope
// for #7A; this gap is reported, not silently worked around.
const { normalizePhone, normalizeName } = require("./normalize");

// Deterministic: exact phone or exact email match against any existing
// user (client or artisan -- a mismatched role is still worth surfacing
// to a human reviewer, not filtered out here).
async function findDeterministicUserMatch(db, candidateData) {
  const phoneNormalized = normalizePhone(candidateData.phone);
  if (phoneNormalized) {
    const rows = await db.prepare("SELECT id, role, name, email, phone FROM users WHERE phone IS NOT NULL").all();
    const match = rows.find((u) => normalizePhone(u.phone) === phoneNormalized);
    if (match) return { user: match, signals: ["phone"] };
  }

  if (candidateData.email) {
    const match = await db
      .prepare("SELECT id, role, name, email FROM users WHERE LOWER(email) = LOWER(?)")
      .get(candidateData.email);
    if (match) return { user: match, signals: ["email"] };
  }

  return null;
}

// Probable: normalized name matches an existing artisan whose trade equals
// the candidate's category_code and whose city matches. Never returns a
// match on name alone -- trade and city must both agree too.
async function findProbableUserMatches(db, candidateData) {
  const normalizedCandidateName = normalizeName(candidateData.display_name);
  if (!normalizedCandidateName || !candidateData.category_code) return [];

  const rows = await db
    .prepare(
      `SELECT u.id, u.role, u.name, u.email, p.trade, p.city
       FROM artisan_profiles p JOIN users u ON u.id = p.user_id
       WHERE p.trade = ?`
    )
    .all(candidateData.category_code);

  return rows
    .filter((u) => normalizeName(u.name) === normalizedCandidateName)
    .filter((u) => !candidateData.city || !u.city || u.city.trim().toLowerCase() === candidateData.city.trim().toLowerCase())
    .map((u) => ({ user: { id: u.id, role: u.role, name: u.name, email: u.email }, signals: ["name", "trade", "city"] }));
}

module.exports = { findDeterministicUserMatch, findProbableUserMatches };
