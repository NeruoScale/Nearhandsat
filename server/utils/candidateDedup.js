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

module.exports = { findDeterministicMatch, findProbableMatches, PROBABLE_MATCH_RADIUS_KM };
