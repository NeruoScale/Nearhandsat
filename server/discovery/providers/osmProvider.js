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
// City-level scoping was NOT verified to work reliably (a boundary-name
// query for "Sétif" returned zero results in this session's testing,
// likely because the real admin boundary relation uses a different exact
// name/tagging than assumed) -- rather than ship an unverified query
// shape, this provider only queries at country level and applies `city`
// as a best-effort post-filter against addr:city/tags.name, consistent
// with "do not assume a data structure you haven't inspected."
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

function buildQuery(isoCode, tag, limit) {
  const filter = `["${tag.key}"="${tag.value}"]`;
  return (
    `[out:json][timeout:25];` +
    `area["ISO3166-1"="${isoCode}"][admin_level=2]->.searchArea;` +
    `(node${filter}(area.searchArea);way${filter}(area.searchArea););` +
    `out center tags ${limit};`
  );
}

function elementToCandidate({ element, categoryCode, countryName, city }) {
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

  return {
    provider: "osm",
    external_id: `${element.type}/${element.id}`,
    display_name: tags.name || null,
    category_code: categoryCode,
    country: countryName,
    state: null,
    city: addrCity || city || null,
    address_raw: [tags["addr:housenumber"], tags["addr:street"], tags["addr:city"]].filter(Boolean).join(" ") || null,
    latitude: lat,
    longitude: lon,
    phone: tags.phone || tags["contact:phone"] || null,
    email: tags.email || tags["contact:email"] || null,
    website: tags.website || tags["contact:website"] || null,
    license: LICENSE,
    source_url: `https://www.openstreetmap.org/${element.type}/${element.id}`,
    raw_payload: { tags: { name: tags.name, phone: tags.phone, website: tags.website } },
  };
}

async function discover({ countryName, categoryCode, city, limit } = {}) {
  const tag = OSM_TAG_BY_CATEGORY[categoryCode];
  if (!tag) return [];

  const isoCode = isoCodeFor(countryName);
  if (!isoCode) return [];

  const cappedLimit = clampLimit(limit);
  const query = buildQuery(isoCode, tag, cappedLimit);

  // Overpass's usage policy expects a real, identifying User-Agent -- a
  // request without one was observed returning HTTP 406 during this
  // phase's real-API testing (a generic default User-Agent was rejected).
  const res = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json",
      "User-Agent": "NearHandsAT-candidate-discovery/1.0 (+https://nearhandsat.com)",
    },
    body: `data=${encodeURIComponent(query)}`,
  });
  if (!res.ok) {
    throw new Error(`Overpass API request failed: HTTP ${res.status}`);
  }
  const body = await res.json();
  const elements = Array.isArray(body.elements) ? body.elements : [];

  return elements
    .map((element) => elementToCandidate({ element, categoryCode, countryName, city }))
    .filter(Boolean);
}

module.exports = { discover, OSM_TAG_BY_CATEGORY };
