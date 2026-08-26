// README roadmap #7A, Phase G: OpenStreetMap / Overpass discovery provider.
//
// Verified against the real, live, public, no-API-key Overpass endpoint
// before writing this (per the #7A mandate: never assume an endpoint or
// response shape). Confirmed live:
//   - POST https://overpass-api.de/api/interpreter with a `data=<Overpass QL>`
//     body returns HTTP 200 JSON: { version, generator, osm3s: { copyright },
//     elements: [{ type, id, lat, lon, tags: {...} }, ...] }.
//   - Country scoping via area["ISO3166-1"="<code>"][admin_level=2] works.
//   - The craft=<value> tag is the correct convention for individual
//     tradespeople (craft=plumber returned 5 real Algeria results).
//   - tags.name is NOT always present -- display_name must tolerate that.
//   - osm3s.copyright confirms ODbL licensing; every candidate_sources row
//     this provider writes must carry that attribution.
//
// City-level scoping: NOT reliable in general (a boundary-name query for
// "Sétif", Algeria returned zero results during #7A's testing, likely
// because the real admin boundary relation there uses a different exact
// name/tagging than assumed) -- so this provider does NOT guess a
// city-boundary admin_level itself, and defaults to country-level +
// `city` post-filter exactly as before. README roadmap #7C verified LIVE
// that major, densely-mapped US cities (Chicago, Houston) DO resolve
// reliably via area["name"="<city>"]["boundary"="administrative"]
// ["admin_level"="8"] -- but that admin_level value is a US-specific OSM
// convention, not a global one, so it is never hardcoded here. A caller
// that has independently verified a working admin_level for a specific
// area (the same way #7C did before using it) may opt into an
// area-scoped query by passing BOTH `city` and `areaAdminLevel` -- the
// provider stays country-agnostic; the verified assumption lives with
// the caller, not in this file.
//
// Category coverage is intentionally partial: OSM_TAG_BY_CATEGORY only
// maps trades with a well-established OSM tagging convention. A category
// with no confident mapping (null below) returns [] without making any
// HTTP request at all -- this provider never guesses a tag.
const { Country } = require("country-state-city");
const { clampLimit } = require("../providerInterface");

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const LICENSE = "ODbL";

// { key: 'craft'|'shop'|'office', value: <osm tag value> }
const OSM_TAG_BY_CATEGORY = {
  "Electrician": { key: "craft", value: "electrician" },
  "Plumber": { key: "craft", value: "plumber" },
  "Carpenter": { key: "craft", value: "carpenter" },
  "Painter": { key: "craft", value: "painter" },
  "Mason": { key: "craft", value: "stonemason" },
  "Roofer": { key: "craft", value: "roofer" },
  "Tiler": { key: "craft", value: "tiler" },
  "Plasterer": { key: "craft", value: "plasterer" },
  "HVAC Technician": { key: "craft", value: "hvac" },
  "Welder": null,
  "Locksmith": { key: "shop", value: "locksmith" },
  "Gardener / Landscaper": { key: "craft", value: "gardener" },
  "Cleaner": null,
  "Mover": { key: "office", value: "moving_company" },
  "Appliance Repair Technician": null,
  "Handyman": { key: "craft", value: "handyman" },
  "Glazier": { key: "craft", value: "glaziery" },
  "Flooring Installer": null,
  "Pool Maintenance": null,
  "Pest Control": null,
  "Solar Panel Installer": null,
  "Blacksmith": { key: "craft", value: "blacksmith" },
  "Upholsterer": { key: "craft", value: "upholsterer" },
  "Auto Mechanic": { key: "shop", value: "car_repair" },
  "Tailor": { key: "craft", value: "tailor" },
};

function isoCodeFor(countryName) {
  const match = Country.getAllCountries().find(
    (c) => c.name.toLowerCase() === String(countryName || "").toLowerCase()
  );
  return match ? match.isoCode : null;
}

function buildQuery(isoCode, tag, limit, { city, areaAdminLevel } = {}) {
  const filter = `["${tag.key}"="${tag.value}"]`;
  // Area-scoped variant: only used when the caller supplies BOTH city and
  // areaAdminLevel (see file header) -- an explicit, verified opt-in, not
  // an inferred default. Falls back to the existing country-level query
  // (unchanged from #7A) in every other case.
  const areaClause =
    city && areaAdminLevel
      ? `area["name"="${city}"]["boundary"="administrative"]["admin_level"="${areaAdminLevel}"]->.searchArea;`
      : `area["ISO3166-1"="${isoCode}"][admin_level=2]->.searchArea;`;
  return (
    `[out:json][timeout:25];` +
    areaClause +
    `(node${filter}(area.searchArea);way${filter}(area.searchArea););` +
    `out center tags ${limit};`
  );
}

// ─── README roadmap #8A: structured OSM metadata envelope ─────────────────────
//
// Overpass's `out center tags` already returns EVERY tag on a matched
// element -- the previous limitation (documented in #7F's investigation)
// was entirely on this file's own side: elementToCandidate() only ever
// copied {name, phone, website, social} into raw_payload, discarding
// everything else Overpass had already sent. This is a capture-time fix
// only -- the Overpass query itself, OSM_TAG_BY_CATEGORY, the category
// matching logic, and every field written onto the `candidates` row
// itself (display_name/state/city/address_raw/phone/email/website) are
// UNCHANGED. Only what goes into candidate_sources.raw_payload (a plain
// TEXT/JSON column, no schema change) is affected.
//
// Explicit, small allowlists -- never "whatever OSM sent." Each group maps
// directly to a real analysis question a future classifier will ask:
//   - identity: what is this thing actually called (beyond the one `name`
//     this app already displays)?
//   - classification: which OSM feature-type tags are present -- lets a
//     future classifier see the RAW shop=/craft=/amenity=/office=/etc.
//     evidence, not just our own derived category_code.
//   - infrastructure: high-value non-business signals (the #7F "Downtown
//     Connector" gap this phase exists to close) -- a future classifier
//     can finally tell a highway/bridge/junction apart from a business
//     using structured evidence instead of guessing from the name alone.
//   - lifecycle: closed/disused/demolished/proposed status, plus
//     check_date/survey:date as a freshness signal (a real tag observed
//     live during #7C testing, e.g. Acuity Electric's check_date).
//   - location: the exact addr:* tags already used to derive the
//     candidate row's own city/state/address_raw fields, kept for source
//     reproducibility.
//   - contact: EXACTLY the existing, already-justified set (#7A's phone/
//     email/website, #7C's social tags) -- not expanded.
const BUSINESS_IDENTITY_TAGS = ["name", "official_name", "short_name", "brand", "operator", "alt_name"];
const BUSINESS_CLASSIFICATION_TAGS = ["shop", "craft", "office", "amenity", "industrial", "healthcare", "tourism", "leisure", "building"];
const INFRASTRUCTURE_TAGS = ["highway", "railway", "waterway", "route", "bridge", "junction", "place", "boundary", "landuse"];
const LIFECYCLE_TAGS = ["disused", "abandoned", "demolished", "construction", "proposed", "check_date", "survey:date"];
const LIFECYCLE_PREFIXES = ["disused:", "was:", "demolished:", "construction:", "proposed:", "abandoned:"];
const LOCATION_TAGS = ["addr:housenumber", "addr:street", "addr:city", "addr:state", "addr:postcode", "addr:country"];
const CONTACT_TAGS = [
  "phone", "contact:phone", "email", "contact:email", "website", "contact:website",
  "contact:facebook", "contact:instagram", "contact:linkedin", "contact:twitter", "contact:youtube",
];

// Everything NOT in one of the lists above is deliberately discarded --
// data minimization (#8A's explicit mandate): opening_hours, payment:*,
// operator-internal notes, free-text `note`/`fixme`, wheelchair access,
// and any other tag Overpass may return never enters storage. This is a
// conscious boundary, not an oversight -- extending it requires a
// specific, justified reason the same way each list above was justified.
function pickAllowlistedTags(tags, allowlist) {
  const picked = {};
  for (const key of allowlist) {
    if (tags[key] !== undefined) picked[key] = tags[key];
  }
  return picked;
}

function pickLifecyclePrefixedTags(tags) {
  const picked = {};
  for (const [key, value] of Object.entries(tags)) {
    if (LIFECYCLE_PREFIXES.some((prefix) => key.startsWith(prefix))) picked[key] = value;
  }
  return picked;
}

function buildOsmMetadataEnvelope({ element, tag }) {
  const tags = element.tags || {};

  const identity = pickAllowlistedTags(tags, BUSINESS_IDENTITY_TAGS);
  const classification = pickAllowlistedTags(tags, BUSINESS_CLASSIFICATION_TAGS);
  const infrastructure = pickAllowlistedTags(tags, INFRASTRUCTURE_TAGS);
  const lifecycle = { ...pickAllowlistedTags(tags, LIFECYCLE_TAGS), ...pickLifecyclePrefixedTags(tags) };
  const location = pickAllowlistedTags(tags, LOCATION_TAGS);
  const contact = pickAllowlistedTags(tags, CONTACT_TAGS);

  const envelopeTags = {
    ...identity,
    ...classification,
    ...infrastructure,
    ...(Object.keys(lifecycle).length > 0 ? lifecycle : {}),
    ...location,
    ...contact,
  };

  return {
    source: "osm",
    osm: {
      type: element.type,
      id: element.id,
      // The EXACT tag that matched our category query -- provenance
      // separation (#8A §16): "OSM returned shop=car_repair" is a
      // different, more durable fact than "our app classified this as
      // Auto Mechanic," and the two must never be conflated into one
      // field.
      category_signal: tag ? { key: tag.key, value: tag.value } : null,
      tags: envelopeTags,
    },
  };
}

function elementToCandidate({ element, categoryCode, countryName, city, tag }) {
  const tags = element.tags || {};
  const lat = element.lat ?? element.center?.lat ?? null;
  const lon = element.lon ?? element.center?.lon ?? null;
  const addrCity = tags["addr:city"] || null;

  // City post-filter (best-effort, see file header) -- only applied when
  // the caller asked for a specific city AND this element actually has an
  // addr:city tag to compare against. An element with no addr:city is kept
  // rather than dropped, since OSM tagging completeness varies a lot and
  // dropping it would silently bias the results.
  if (city && addrCity && addrCity.trim().toLowerCase() !== city.trim().toLowerCase()) {
    return null;
  }

  // README roadmap #7C: social/contact-profile tags, used for the
  // candidate row's own display fields -- unchanged from #7C. The
  // structured, fuller capture of the same tags now also lives in
  // raw_payload.osm.tags (see buildOsmMetadataEnvelope above); this
  // block is kept exactly as-is so display_name/phone/email/website on
  // the `candidates` row itself are byte-for-byte unaffected by #8A.
  const socialTags = {};
  for (const key of ["contact:facebook", "contact:instagram", "contact:linkedin", "contact:twitter", "contact:youtube"]) {
    if (tags[key]) socialTags[key] = tags[key];
  }

  return {
    provider: "osm",
    external_id: `${element.type}/${element.id}`,
    display_name: tags.name || null,
    category_code: categoryCode,
    country: countryName,
    state: tags["addr:state"] || null,
    city: addrCity || city || null,
    address_raw: [tags["addr:housenumber"], tags["addr:street"], tags["addr:city"]].filter(Boolean).join(" ") || null,
    latitude: lat,
    longitude: lon,
    phone: tags.phone || tags["contact:phone"] || null,
    email: tags.email || tags["contact:email"] || null,
    website: tags.website || tags["contact:website"] || null,
    license: LICENSE,
    source_url: `https://www.openstreetmap.org/${element.type}/${element.id}`,
    raw_payload: buildOsmMetadataEnvelope({ element, tag }),
  };
}

// Overpass's usage policy expects a real, identifying User-Agent -- a
// request without one was observed returning HTTP 406 during #7A's
// real-API testing (a generic default User-Agent was rejected).
async function postOverpassQuery(query) {
  return fetch(OVERPASS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json",
      "User-Agent": "NearHandsAT-candidate-discovery/1.0 (+https://nearhandsat.com)",
    },
    body: `data=${encodeURIComponent(query)}`,
  });
}

async function discover({ countryName, categoryCode, city, limit, areaAdminLevel } = {}) {
  const tag = OSM_TAG_BY_CATEGORY[categoryCode];
  if (!tag) return [];

  const isoCode = isoCodeFor(countryName);
  if (!isoCode) return [];

  const cappedLimit = clampLimit(limit);
  const query = buildQuery(isoCode, tag, cappedLimit, { city, areaAdminLevel });

  const res = await postOverpassQuery(query);
  if (!res.ok) {
    throw new Error(`Overpass API request failed: HTTP ${res.status}`);
  }
  const body = await res.json();
  const elements = Array.isArray(body.elements) ? body.elements : [];

  return elements
    .map((element) => elementToCandidate({ element, categoryCode, countryName, city, tag }))
    .filter(Boolean);
}

// README roadmap #7D: boundary-verification helper for geographic
// generalization beyond the 3 cities #7C already confirmed by hand. A
// caller MUST run this before requesting a city-scoped discover() for a
// new city -- discover() itself still does not guess or fall back (see
// buildQuery's areaClause: a city-scoped call always uses exactly the
// area the caller specified, succeeding or failing on its own, never
// silently reverting to a country-level query). This function answers
// ONLY "does this area["name"=...]["admin_level"=...] resolve to a real
// area with a non-empty result," as cheaply as possible: `out ids 1`
// returns at most one bare element id, never fetches business data, so
// verifying a city costs a fraction of a real category query.
async function verifyAreaBoundary(city, areaAdminLevel) {
  if (!city || !areaAdminLevel) {
    return { verified: false, reason: "city and areaAdminLevel are both required" };
  }
  const query =
    `[out:json][timeout:25];` +
    `area["name"="${city}"]["boundary"="administrative"]["admin_level"="${areaAdminLevel}"]->.searchArea;` +
    `node(area.searchArea);` +
    `out ids 1;`;

  let res;
  try {
    res = await postOverpassQuery(query);
  } catch (err) {
    return { verified: false, reason: `network error: ${err.message}` };
  }
  if (!res.ok) {
    return { verified: false, reason: `Overpass API request failed: HTTP ${res.status}` };
  }
  const body = await res.json();
  const elements = Array.isArray(body.elements) ? body.elements : [];
  if (elements.length === 0) {
    return { verified: false, reason: "area resolved to zero elements -- boundary name/admin_level likely does not match a real OSM relation" };
  }
  return { verified: true, reason: null };
}

module.exports = {
  discover,
  verifyAreaBoundary,
  OSM_TAG_BY_CATEGORY,
  buildOsmMetadataEnvelope,
  elementToCandidate,
  BUSINESS_IDENTITY_TAGS,
  BUSINESS_CLASSIFICATION_TAGS,
  INFRASTRUCTURE_TAGS,
  LIFECYCLE_TAGS,
  LIFECYCLE_PREFIXES,
  LOCATION_TAGS,
  CONTACT_TAGS,
};
