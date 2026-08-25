// README roadmap #7A, Phase H: candidate ingestion pipeline.
//
// Wires together: a discovery provider (Phase G) -> normalization
// (Phase D) -> deduplication (Phase E) -> NearHandsAT-identity matching
// (Phase F) -> storage (Phase C schema). Manually invoked only -- no
// cron/scheduler/worker infrastructure exists or is added here, per the
// #7A mandate. The caller (the admin-only route in Phase I) decides when
// this runs; this module has no timers of its own.
const osmProvider = require("./providers/osmProvider");
const {
  normalizeCategory,
  normalizeName,
  normalizePhone,
  normalizeWebsiteDomain,
} = require("../utils/normalize");
const { findDeterministicMatch, findProbableMatches, findPhysicalProximityMatches } = require("../utils/candidateDedup");
const { findDeterministicUserMatch, findProbableUserMatches } = require("../utils/candidateIdentityMatch");

const PROVIDERS = { osm: osmProvider };

async function recordEvent(db, candidateId, eventType, { fromStatus = null, toStatus = null, detail = null } = {}) {
  await db
    .prepare(
      "INSERT INTO candidate_events (candidate_id, event_type, from_status, to_status, detail) VALUES (?,?,?,?,?)"
    )
    .run(candidateId, eventType, fromStatus, toStatus, detail ? JSON.stringify(detail) : null);
}

// A given provider record (e.g. a specific OSM node) must always resolve
// back to the same candidate row -- candidate_sources' UNIQUE(provider,
// external_id) constraint already enforces that at the DB level, but the
// ingestion logic itself must check this FIRST, before any business-signal
// dedup (phone/email/website/name+location). Those signals answer "is this
// a different sighting of the same real-world business"; this answers the
// narrower, more reliable question "have we already stored this exact
// source record." Skipping this check would let a re-ingested record with
// no phone/email/website (a real, observed case with sparse OSM data)
// silently create an orphaned duplicate candidate while its source row
// stays attached to the original -- confirmed by re-ingestion testing
// during this phase.
async function findExistingSourceCandidateId(db, provider, externalId) {
  if (!externalId) return null;
  const row = await db
    .prepare("SELECT candidate_id FROM candidate_sources WHERE provider = ? AND external_id = ?")
    .get(provider, externalId);
  return row ? row.candidate_id : null;
}

async function recordSource(db, candidateId, raw) {
  // INSERT OR IGNORE / ON CONFLICT DO NOTHING both no-op on the
  // (provider, external_id) unique constraint -- re-ingesting the exact
  // same provider record is safe to run repeatedly, never creates a
  // duplicate provenance row.
  await db
    .prepare(
      `INSERT INTO candidate_sources (candidate_id, provider, external_id, source_url, license, raw_payload)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT(provider, external_id) DO NOTHING`
    )
    .run(candidateId, raw.provider, raw.external_id, raw.source_url, raw.license, raw.raw_payload ? JSON.stringify(raw.raw_payload) : null);
}

// Ingests candidates for one (provider, country, category) combination.
// `limit` is enforced by the provider itself (see providerInterface.js).
// Returns a summary object -- no candidate row is ever silently dropped
// without being reflected in one of these counters.
async function ingestCandidates(db, { provider = "osm", countryName, categoryCode, city, limit } = {}) {
  const providerModule = PROVIDERS[provider];
  if (!providerModule) {
    throw new Error(`Unknown discovery provider: ${provider}`);
  }
  if (!countryName || !categoryCode) {
    throw new Error("countryName and categoryCode are required.");
  }
  // Validate categoryCode against the real taxonomy rather than trusting
  // caller input blindly -- normalizeCategory returns null for anything
  // that isn't one of the 25 existing trade codes.
  const resolvedCategory = normalizeCategory(categoryCode) || categoryCode;

  const rawCandidates = await providerModule.discover({ countryName, categoryCode: resolvedCategory, city, limit });

  const summary = {
    discovered: rawCandidates.length,
    newCandidates: 0,
    mergedIntoExisting: 0,
    probableDuplicatesFlagged: 0,
    identityMatchesFound: 0,
    candidateIds: [],
  };

  for (const raw of rawCandidates) {
    const candidateData = {
      category_code: raw.category_code,
      display_name: raw.display_name,
      normalized_name: normalizeName(raw.display_name),
      country: raw.country,
      state: raw.state,
      city: raw.city,
      address_raw: raw.address_raw,
      latitude: raw.latitude,
      longitude: raw.longitude,
      phone: raw.phone,
      phone_normalized: normalizePhone(raw.phone),
      email: raw.email,
      website: raw.website,
      website_domain: normalizeWebsiteDomain(raw.website),
    };

    const existingSourceCandidateId = await findExistingSourceCandidateId(db, raw.provider, raw.external_id);
    const deterministicMatch = existingSourceCandidateId
      ? null
      : await findDeterministicMatch(db, candidateData);
    const mergeTargetId = existingSourceCandidateId || (deterministicMatch && deterministicMatch.candidate.id);

    if (mergeTargetId) {
      await recordSource(db, mergeTargetId, raw);
      await recordEvent(db, mergeTargetId, "re_discovered", {
        detail: {
          provider: raw.provider,
          signal: existingSourceCandidateId ? "same_source_record" : deterministicMatch.signal,
        },
      });
      await db.prepare("UPDATE candidates SET last_seen_at = datetime('now') WHERE id = ?").run(mergeTargetId);
      summary.mergedIntoExisting += 1;
      summary.candidateIds.push(mergeTargetId);
      continue;
    }

    const info = await db
      .prepare(
        `INSERT INTO candidates
          (category_code, display_name, normalized_name, country, state, city, address_raw,
           latitude, longitude, phone, phone_normalized, email, website, website_domain, status)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'discovered')`
      )
      .run(
        candidateData.category_code,
        candidateData.display_name,
        candidateData.normalized_name,
        candidateData.country,
        candidateData.state,
        candidateData.city,
        candidateData.address_raw,
        candidateData.latitude,
        candidateData.longitude,
        candidateData.phone,
        candidateData.phone_normalized,
        candidateData.email,
        candidateData.website,
        candidateData.website_domain
      );
    const newId = info.lastInsertRowid;
    summary.newCandidates += 1;
    summary.candidateIds.push(newId);

    await recordSource(db, newId, raw);
    await recordEvent(db, newId, "discovered", { toStatus: "discovered", detail: { provider: raw.provider } });

    // Probable-duplicate check against other already-stored candidates.
    // Never auto-merges -- just logs, on both sides, for admin review.
    const probableMatches = await findProbableMatches(db, candidateData);
    const alreadyFlaggedIds = new Set();
    for (const { candidate: otherCandidate, signals } of probableMatches) {
      if (otherCandidate.id === newId) continue;
      await recordEvent(db, newId, "probable_duplicate_flagged", {
        detail: { otherCandidateId: otherCandidate.id, signals },
      });
      await recordEvent(db, otherCandidate.id, "probable_duplicate_flagged", {
        detail: { otherCandidateId: newId, signals },
      });
      summary.probableDuplicatesFlagged += 1;
      alreadyFlaggedIds.add(otherCandidate.id);
    }

    // README roadmap #7B: physical-location proximity check -- a separate,
    // narrower signal for pairs the name-based check above can't see (one
    // or both sides unnamed). Skips any pair the name-based check already
    // flagged in this same pass, so a single real-world duplicate never
    // produces two redundant event pairs. Same non-merging, admin-review-
    // only mechanism as above, distinguished by a `confidence` field the
    // name-based signal's event detail deliberately does not carry.
    const proximityMatches = await findPhysicalProximityMatches(db, candidateData);
    for (const { candidate: otherCandidate, confidence, signals, distanceMeters } of proximityMatches) {
      if (otherCandidate.id === newId || alreadyFlaggedIds.has(otherCandidate.id)) continue;
      await recordEvent(db, newId, "probable_duplicate_flagged", {
        detail: { otherCandidateId: otherCandidate.id, signals, confidence, distanceMeters },
      });
      await recordEvent(db, otherCandidate.id, "probable_duplicate_flagged", {
        detail: { otherCandidateId: newId, signals, confidence, distanceMeters },
      });
      summary.probableDuplicatesFlagged += 1;
    }

    // NearHandsAT-identity matching -- read-only, logs only. Never
    // modifies users, never deletes/modifies the candidate beyond this
    // event log entry.
    const deterministicUserMatch = await findDeterministicUserMatch(db, candidateData);
    if (deterministicUserMatch) {
      await recordEvent(db, newId, "identity_match_found", {
        detail: {
          matched_user_id: deterministicUserMatch.user.id,
          signals: deterministicUserMatch.signals,
          confidence: "deterministic",
        },
      });
      summary.identityMatchesFound += 1;
    } else {
      const probableUserMatches = await findProbableUserMatches(db, candidateData);
      for (const { user, signals } of probableUserMatches) {
        await recordEvent(db, newId, "identity_match_found", {
          detail: { matched_user_id: user.id, signals, confidence: "probable" },
        });
        summary.identityMatchesFound += 1;
      }
    }
  }

  return summary;
}

module.exports = { ingestCandidates, PROVIDERS };
