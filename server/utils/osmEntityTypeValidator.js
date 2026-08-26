// README roadmap #8B: OSM entity-type validation using #8A's structured
// metadata envelope.
//
// A DELIBERATELY SEPARATE evidence layer from server/utils/
// entityQualityClassifier.js (#7D-#7F): that module answers "is this an
// institution/franchise/defunct listing/category mismatch, given a
// candidate's NAME and a few derived row fields (website, category)."
// This module answers a narrower, earlier question: "what does OSM's OWN
// STRUCTURED TAG DATA say this object is" -- never touching a name string
// at all. Source evidence -> analysis -> classification, never the other
// way around (per #8A §16's provenance-separation principle).
//
// Pure, deterministic, side-effect free: no DB access, no network call,
// not wired into the ingestion pipeline, not called by
// entityQualityClassifier.js. Input is exactly the `.osm` sub-object
// #8A's buildOsmMetadataEnvelope() produces -- { type, id, category_signal,
// tags } -- so the real future call pattern is
// `validateOsmEntityType(candidate.raw_payload.osm)`.
//
// This module does NOT run against the historical 62 #7C/#7D candidates:
// they predate #8A's richer capture, so their real stored `.osm.tags` is
// either absent entirely or the old narrow shape. Running this validator
// against them would correctly (and honestly) return "uncertain" for
// nearly all of them -- which is not a new finding, just a restatement of
// #7F's own conclusion, and #8B does not retrofit or reinterpret that
// historical dataset (see the #8B report).

// ─── Evidence vocabularies ──────────────────────────────────────────────────
//
// Deliberately a SUBSET of #8A's own capture allowlists -- if #8A didn't
// capture a tag, this validator can never see it, so there's no reason to
// reference tags outside that envelope. Every key here also appears in
// osmProvider.js's own allowlists (BUSINESS_CLASSIFICATION_TAGS,
// INFRASTRUCTURE_TAGS, LIFECYCLE_TAGS/_PREFIXES) -- this is intentional,
// not a coincidence; the validator only reasons about evidence #8A
// actually preserves.

// Keys that are ALWAYS business-indicating in OSM convention regardless of
// their value -- craft=<anything> and shop=<anything> are individual-
// tradesperson/retail tags by definition (the same convention #7A's
// OSM_TAG_BY_CATEGORY already relies on for discovery itself).
const ALWAYS_BUSINESS_KEYS = ["shop", "craft"];

// Keys whose VALUE decides whether they're institutional or ordinary
// business evidence -- "office=government" and "office=company" are not
// the same fact, even though they share a key.
const INSTITUTIONAL_VALUES_BY_KEY = {
  amenity: ["school", "college", "university", "kindergarten", "childcare", "training", "driving_school", "social_facility"],
  office: ["association", "government", "ngo", "diplomatic", "political_party", "religion"],
};
// Any OTHER value for these keys counts as ordinary business evidence
// (e.g. amenity=restaurant, office=company, office=lawyer).
const VALUE_DEPENDENT_KEYS = ["amenity", "office"];

// Present regardless of value, moderate (not top-tier) business evidence --
// #8A captures these but they cover a wide, sometimes ambiguous range
// (e.g. `leisure` covers both a gym business and a public park), so they
// support business_candidate only when nothing stronger or conflicting is
// present, never alone at the highest confidence tier.
const MODERATE_BUSINESS_KEYS = ["commercial", "industrial", "healthcare", "tourism", "leisure", "building"];

const INFRASTRUCTURE_KEYS = ["highway", "railway", "waterway", "route", "bridge", "junction", "place", "boundary", "landuse"];

const BARE_LIFECYCLE_KEYS = ["disused", "abandoned", "demolished", "construction", "proposed"];
const LIFECYCLE_PREFIXES = ["disused:", "was:", "demolished:", "construction:", "proposed:", "abandoned:"];

function tagsWithKeys(tags, keys) {
  return keys.filter((k) => tags[k] !== undefined);
}

function lifecyclePrefixedKeys(tags) {
  return Object.keys(tags).filter((k) => LIFECYCLE_PREFIXES.some((p) => k.startsWith(p)));
}

function institutionalKeysPresent(tags) {
  const hits = [];
  for (const key of VALUE_DEPENDENT_KEYS) {
    const value = tags[key];
    if (value !== undefined && (INSTITUTIONAL_VALUES_BY_KEY[key] || []).includes(value)) hits.push(key);
  }
  if (tags.social_facility !== undefined) hits.push("social_facility");
  return hits;
}

function businessKeysPresent(tags) {
  const strong = tagsWithKeys(tags, ALWAYS_BUSINESS_KEYS);
  const valueDependentBusiness = VALUE_DEPENDENT_KEYS.filter((key) => {
    const value = tags[key];
    return value !== undefined && !(INSTITUTIONAL_VALUES_BY_KEY[key] || []).includes(value);
  });
  const moderate = tagsWithKeys(tags, MODERATE_BUSINESS_KEYS);
  return { strong: [...strong, ...valueDependentBusiness], moderate };
}

/**
 * validateOsmEntityType(osmMetadata): osmMetadata is the `.osm` sub-object
 * from #8A's envelope -- { type, id, category_signal, tags }. `tags` may
 * be missing/empty (a real, common case -- 5 of #7C/#7D's own 62
 * candidates had empty tags).
 *
 * -> {
 *      classification: "business_candidate" | "institutional" |
 *        "infrastructure_or_geographic" | "defunct_or_disused" | "uncertain",
 *      confidence: "high" | "medium" | "low" | "none",
 *      reasons: string[],
 *      evidence: { key: string, value: string }[],
 *    }
 *
 * Precedence (documented, deterministic -- see #8B report §B for the
 * justification of this exact order):
 *   1. Lifecycle evidence (disused/abandoned/demolished/construction/
 *      proposed, bare or prefixed) -> defunct_or_disused. Checked FIRST:
 *      a business tag that is ALSO marked disused (e.g. disused:shop=
 *      car_repair) is not a currently-operating business_candidate.
 *   2. Infrastructure AND (business OR institutional) evidence BOTH
 *      present -> uncertain. This is a genuine data conflict (a node/way
 *      should not usually carry both), and #8B's mandate is explicit:
 *      "uncertain is preferable to a false exclusion." Never guessed.
 *   3. Infrastructure evidence alone -> infrastructure_or_geographic,
 *      high confidence.
 *   4. Institutional evidence alone (no business keys) -> institutional,
 *      high confidence.
 *   5. Strong business evidence (shop=/craft=/office=company-like/
 *      amenity=non-institutional) -> business_candidate, high confidence.
 *   6. Only moderate business evidence (commercial/industrial/healthcare/
 *      tourism/leisure/building) -> business_candidate, medium confidence.
 *   7. Nothing structured at all (name-only or fully empty) -> uncertain,
 *      "none"/"low" confidence. NAME IS NEVER EXAMINED -- this function
 *      does not accept or read a name field at all, structurally
 *      guaranteeing name-only evidence can never drive a classification
 *      (the #7F finding, enforced by the function's own input contract,
 *      not just by convention).
 */
function validateOsmEntityType(osmMetadata) {
  const tags = (osmMetadata && osmMetadata.tags) || {};

  const lifecycleBare = tagsWithKeys(tags, BARE_LIFECYCLE_KEYS);
  const lifecyclePrefixed = lifecyclePrefixedKeys(tags);
  if (lifecycleBare.length > 0 || lifecyclePrefixed.length > 0) {
    const evidence = [...lifecycleBare, ...lifecyclePrefixed].map((key) => ({ key, value: tags[key] }));
    return {
      classification: "defunct_or_disused",
      confidence: lifecyclePrefixed.length > 0 ? "high" : "medium",
      reasons: [
        lifecyclePrefixed.length > 0
          ? `lifecycle-prefixed tag(s) directly tie a category tag to a non-operational status: ${lifecyclePrefixed.join(", ")}`
          : `bare lifecycle tag(s) present: ${lifecycleBare.join(", ")}`,
      ],
      evidence,
    };
  }

  const infra = tagsWithKeys(tags, INFRASTRUCTURE_KEYS);
  const institutional = institutionalKeysPresent(tags);
  const business = businessKeysPresent(tags);
  const hasBusinessOrInstitutional = institutional.length > 0 || business.strong.length > 0 || business.moderate.length > 0;

  if (infra.length > 0 && hasBusinessOrInstitutional) {
    const conflictingKeys = [...infra, ...institutional, ...business.strong, ...business.moderate];
    return {
      classification: "uncertain",
      confidence: "low",
      reasons: [`conflicting structured evidence: infrastructure tag(s) (${infra.join(", ")}) co-occur with business/institutional tag(s) (${[...institutional, ...business.strong, ...business.moderate].join(", ")}) -- not resolved automatically`],
      evidence: conflictingKeys.map((key) => ({ key, value: tags[key] })),
    };
  }

  if (infra.length > 0) {
    return {
      classification: "infrastructure_or_geographic",
      confidence: "high",
      reasons: [`structured infrastructure/geographic tag(s) present: ${infra.join(", ")}`],
      evidence: infra.map((key) => ({ key, value: tags[key] })),
    };
  }

  if (institutional.length > 0) {
    return {
      classification: "institutional",
      confidence: "high",
      reasons: [`structured institutional tag/value present: ${institutional.map((k) => `${k}=${tags[k]}`).join(", ")}`],
      evidence: institutional.map((key) => ({ key, value: tags[key] })),
    };
  }

  if (business.strong.length > 0) {
    return {
      classification: "business_candidate",
      confidence: "high",
      reasons: [`structured business tag(s) present: ${business.strong.map((k) => `${k}=${tags[k]}`).join(", ")}`],
      evidence: business.strong.map((key) => ({ key, value: tags[key] })),
    };
  }

  if (business.moderate.length > 0) {
    return {
      classification: "business_candidate",
      confidence: "medium",
      reasons: [`only moderate-strength business-adjacent tag(s) present: ${business.moderate.join(", ")}`],
      evidence: business.moderate.map((key) => ({ key, value: tags[key] })),
    };
  }

  return {
    classification: "uncertain",
    confidence: Object.keys(tags).length > 0 ? "low" : "none",
    reasons: ["no structured business, institutional, infrastructure, or lifecycle evidence present (name, if any, is never used as classification evidence by this function)"],
    evidence: [],
  };
}

module.exports = {
  validateOsmEntityType,
  ALWAYS_BUSINESS_KEYS,
  INSTITUTIONAL_VALUES_BY_KEY,
  VALUE_DEPENDENT_KEYS,
  MODERATE_BUSINESS_KEYS,
  INFRASTRUCTURE_KEYS,
  BARE_LIFECYCLE_KEYS,
  LIFECYCLE_PREFIXES,
};
