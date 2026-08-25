// README roadmap #7A, Phase E: candidate deduplication.
//
// Two distinct tiers, deliberately kept separate and never blended into a
// single "score":
//
//   - Deterministic: a signal that is, on its own, reliable enough to treat
//     two candidate sightings as the same real-world business (exact
//     normalized phone, exact email, or exact website domain). The
//     ingestion pipeline (Phase H) auto-merges on a deterministic match --
//     no new candidate row, just another candidate_sources row plus a
//     candidate_events 're_discovered' entry on the existing candidate.
//
//   - Probable: normalized name + category + same city/near-proximity
//     together. This is intentionally NEVER based on name alone (name
//     collisions are common: two unrelated "Ali Electricité" businesses in
//     different neighborhoods of the same city are a realistic case, not
//     an edge case). A probable match does NOT auto-merge -- it creates
//     its own candidate row and records a 'probable_duplicate_flagged'
//     candidate_events entry on both candidates (pointing at each other's
//     id only inside the free-text `detail` column, never as a live FK),
//     leaving the actual merge decision to a human reviewer via the
//     admin API (Phase I). Silently guessing is explicitly out of scope.
const { distanceKm, resolveLocation } = require("./geo");

const PROBABLE_MATCH_RADIUS_KM = 2;

// candidateData: the already-normalized fields being considered for
// insertion (phone_normalized, email, website_domain, normalized_name,
// category_code, country, state, city, latitude, longitude). Only
// non-duplicate candidates are matched against -- a row already marked
// 'duplicate' is not itself a valid merge target.
async function findDeterministicMatch(db, candidateData) {
  const { phone_normalized, email, website_domain } = candidateData;

  if (phone_normalized) {
    const row = await db
      .prepare("SELECT * FROM candidates WHERE phone_normalized = ? AND status != 'duplicate'")
      .get(phone_normalized);
    if (row) return { candidate: row, signal: "phone" };
  }

  if (email) {
    const row = await db
      .prepare("SELECT * FROM candidates WHERE LOWER(email) = LOWER(?) AND status != 'duplicate'")
      .get(email);
    if (row) return { candidate: row, signal: "email" };
  }

  if (website_domain) {
    const row = await db
      .prepare("SELECT * FROM candidates WHERE website_domain = ? AND status != 'duplicate'")
      .get(website_domain);
    if (row) return { candidate: row, signal: "website_domain" };
  }

  return null;
}

// Returns every existing candidate that is a *probable* (not deterministic)
// duplicate of candidateData: same normalized name AND same category AND
// (same city text OR within PROBABLE_MATCH_RADIUS_KM). Never returns a
// match on name alone.
async function findProbableMatches(db, candidateData) {
  const { normalized_name, category_code, country, state, city, latitude, longitude } = candidateData;
  if (!normalized_name || !category_code) return [];

  const sameNameAndCategory = await db
    .prepare(
      "SELECT * FROM candidates WHERE normalized_name = ? AND category_code = ? AND status != 'duplicate'"
    )
    .all(normalized_name, category_code);

  if (sameNameAndCategory.length === 0) return [];

  const searchLocation = resolveLocation({ country, state, city, latitude, longitude });

  return sameNameAndCategory
    .map((row) => {
      if (city && row.city && city.trim().toLowerCase() === row.city.trim().toLowerCase()) {
        return { candidate: row, signals: ["name", "category", "city"] };
      }
      if (searchLocation) {
        const rowLocation = resolveLocation(row);
        if (rowLocation && distanceKm(searchLocation, rowLocation) <= PROBABLE_MATCH_RADIUS_KM) {
          return { candidate: row, signals: ["name", "category", "proximity"] };
        }
      }
      return null;
    })
    .filter(Boolean);
}

// README roadmap #7B: physical-location duplicate signal.
//
// A real, measured gap in the roadmap #7A dedup model above: multiple OSM
// nodes often represent the same physical business (a shop entrance, a
// delivery door, a signage point, etc.) with NO name on one or both nodes
// -- and findProbableMatches() requires a normalized_name match before
// proximity is even considered, so these pairs were never flagged. Found
// via real #7B validation data: 8 same-category candidate pairs within
// 8-500m, most unnamed on at least one side, none flagged by the existing
// model.
//
// Deliberately conservative and kept separate from findProbableMatches
// (this file's existing "distinct tiers, never blended into a single
// score" design extends naturally to a third tier here): never a blanket
// "same category + nearby == duplicate" rule. Two confidence bands:
//
//   - strong:   <= STRONG_PROXIMITY_RADIUS_KM apart, same category, no
//               conflicting identity signal (differing name/phone/email/
//               website on both sides).
//   - moderate: > strong and <= MODERATE_PROXIMITY_RADIUS_KM apart, same
//               category, no conflicting identity signal, AND at least
//               one piece of independent corroborating evidence (matching
//               city text or matching address_raw text). Distance alone
//               in this wider band is never enough on its own -- the real
//               500m pairs observed in #7B are diagnostic only, not an
//               automatic duplicate threshold.
//
// A name/phone/email/website that's present and DIFFERS on both sides is
// treated as concrete evidence of two separate businesses and suppresses
// the signal entirely (both bands) -- a missing value on either side is
// never treated as a conflict, since there's nothing to conflict with.
//
// Like findProbableMatches, this NEVER auto-merges or deletes -- the
// ingestion pipeline records a match as a candidate_events
// 'probable_duplicate_flagged' entry for admin review, the exact same
// mechanism the name-based signal already uses, just with a different
// `signals` list and a `confidence` field in the event detail.
const STRONG_PROXIMITY_RADIUS_KM = 0.05; // 50 meters
const MODERATE_PROXIMITY_RADIUS_KM = 0.15; // 150 meters

function hasConflictingIdentity(a, b) {
  if (a.normalized_name && b.normalized_name && a.normalized_name !== b.normalized_name) return true;
  if (a.phone_normalized && b.phone_normalized && a.phone_normalized !== b.phone_normalized) return true;
  if (a.email && b.email && a.email.toLowerCase() !== b.email.toLowerCase()) return true;
  if (a.website_domain && b.website_domain && a.website_domain !== b.website_domain) return true;
  return false;
}

function hasCorroboratingLocationEvidence(a, b) {
  if (a.city && b.city && a.city.trim().toLowerCase() === b.city.trim().toLowerCase()) return true;
  if (a.address_raw && b.address_raw && a.address_raw.trim().toLowerCase() === b.address_raw.trim().toLowerCase()) return true;
  return false;
}

// Returns every existing candidate that is a probable PHYSICAL-LOCATION
// duplicate of candidateData. Requires latitude/longitude on both sides --
// returns [] (never throws) when coordinates are missing on either side,
// so a candidate with no coordinates simply isn't eligible for this
// signal rather than crashing the pipeline.
async function findPhysicalProximityMatches(db, candidateData) {
  const { category_code, latitude, longitude } = candidateData;
  if (!category_code) return [];
  if (latitude == null || longitude == null) return [];

  const sameCategory = await db
    .prepare(
      "SELECT * FROM candidates WHERE category_code = ? AND status != 'duplicate' AND latitude IS NOT NULL AND longitude IS NOT NULL"
    )
    .all(category_code);

  const here = { lat: Number(latitude), lng: Number(longitude) };

  return sameCategory
    .map((row) => {
      if (hasConflictingIdentity(candidateData, row)) return null;

      const there = { lat: Number(row.latitude), lng: Number(row.longitude) };
      const distanceMeters = Math.round(distanceKm(here, there) * 1000);

      if (distanceMeters <= STRONG_PROXIMITY_RADIUS_KM * 1000) {
        return { candidate: row, confidence: "strong", signals: ["proximity", "category"], distanceMeters };
      }
      if (distanceMeters <= MODERATE_PROXIMITY_RADIUS_KM * 1000 && hasCorroboratingLocationEvidence(candidateData, row)) {
        return { candidate: row, confidence: "moderate", signals: ["proximity", "category", "location_evidence"], distanceMeters };
      }
      return null;
    })
    .filter(Boolean);
}

module.exports = {
  findDeterministicMatch,
  findProbableMatches,
  findPhysicalProximityMatches,
  PROBABLE_MATCH_RADIUS_KM,
  STRONG_PROXIMITY_RADIUS_KM,
  MODERATE_PROXIMITY_RADIUS_KM,
};
