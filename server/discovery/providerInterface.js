// README roadmap #7A, Phase G: provider-agnostic discovery contract.
//
// JS has no real interfaces, so this file is documentation plus one shared
// helper -- every provider module (server/discovery/providers/*.js) exports
// a single async function matching this shape:
//
//   async function discover({ countryName, categoryCode, city, limit })
//     -> Promise<Array<RawCandidate>>
//
// RawCandidate (the common shape every provider must normalize its own
// data into before returning):
//   {
//     provider: string,          // e.g. "osm" -- stable id for candidate_sources.provider
//     external_id: string|null,  // the provider's own record id, for candidate_sources.external_id
//     display_name: string|null,
//     category_code: string,     // one of the existing TRADES/categories.code values
//     country: string,           // matches the countryName that was requested
//     state: string|null,
//     city: string|null,
//     address_raw: string|null,
//     latitude: number|null,
//     longitude: number|null,
//     phone: string|null,
//     email: string|null,
//     website: string|null,
//     license: string|null,      // attribution/license this record was published under
//     source_url: string|null,
//     raw_payload: object|null,  // ONLY the specific fields actually used -- never the
//                                // provider's full response (see candidate_sources'
//                                // "don't persist raw provider payloads unnecessarily")
//   }
//
// A provider that has no reliable way to serve a given category (no
// confident tag/field mapping) must return [] for it rather than guessing
// -- see providers/osmProvider.js's OSM_TAG_BY_CATEGORY for the pattern.
//
// `limit` is a hard cap the provider must enforce itself (never delegate
// "how much to fetch" entirely to the remote API) -- #7A explicitly
// forbids building an unrestricted crawler.
const MAX_DISCOVERY_LIMIT = 50;

function clampLimit(requested) {
  const n = parseInt(requested, 10);
  if (!Number.isFinite(n) || n <= 0) return 10;
  return Math.min(n, MAX_DISCOVERY_LIMIT);
}

module.exports = { MAX_DISCOVERY_LIMIT, clampLimit };
