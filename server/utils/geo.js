// Radius-based search eligibility (README roadmap #2). Resolves a coordinate
// for a location described as free-text country/state/city -- or uses an
// artisan's own explicitly-shared GPS coordinate when present -- and
// computes great-circle distance against a professional's service_radius_km.
//
// No new geolocation service and no schema change: coordinates come from
// either artisan_profiles.latitude/longitude (already persisted, opt-in via
// the browser Geolocation API) or from the country-state-city dataset that
// already ships with this app for the location pickers. That dataset's
// country/state/city name strings don't always match our stored text
// byte-for-byte (e.g. seed data has "Setif", the dataset has "Sétif"), so
// matching is diacritic- and case-insensitive.
const { Country, State, City } = require("country-state-city");

function normalize(str) {
  return String(str || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

// Cities of a country, flattened across every one of its states. Used when a
// record has a city but no (or an unmatched) state -- exactly the seed-data
// shape, where state was never populated. The dataset is static, so this is
// cached per country instead of recomputed per artisan per request.
const citiesByCountryCache = new Map();
function allCitiesOfCountry(countryIso) {
  if (citiesByCountryCache.has(countryIso)) return citiesByCountryCache.get(countryIso);
  const states = State.getStatesOfCountry(countryIso);
  const cities =
    states.length > 0
      ? states.flatMap((s) => City.getCitiesOfState(countryIso, s.isoCode))
      : City.getCitiesOfCountry(countryIso) || [];
  citiesByCountryCache.set(countryIso, cities);
  return cities;
}

function toCoord(entity) {
  if (!entity || entity.latitude == null || entity.longitude == null) return null;
  const lat = Number(entity.latitude);
  const lng = Number(entity.longitude);
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
  return { lat, lng };
}

// Resolves { lat, lng } for a { country, state, city, latitude, longitude }
// shape, in this priority order:
//   1. explicit latitude/longitude, if both are present and valid (an
//      artisan's own shared GPS position -- the most precise source)
//   2. the dataset's city-level coordinate, matched by normalized name
//   3. the dataset's state-level coordinate
//   4. the dataset's country-level coordinate
// Returns null if none of the above resolve -- callers must treat that as
// "no location data available" and must not invent a fallback distance.
function resolveLocation({ country, state, city, latitude, longitude } = {}) {
  const explicit = toCoord({ latitude, longitude });
  if (explicit) return explicit;

  if (!country) return null;
  const countryObj = Country.getAllCountries().find((c) => normalize(c.name) === normalize(country));
  if (!countryObj) return null;

  const states = State.getStatesOfCountry(countryObj.isoCode);
  const stateObj = state ? states.find((s) => normalize(s.name) === normalize(state)) : null;

  if (city) {
    const cities = stateObj
      ? City.getCitiesOfState(countryObj.isoCode, stateObj.isoCode)
      : allCitiesOfCountry(countryObj.isoCode);
    const cityObj = cities.find((c) => normalize(c.name) === normalize(city));
    const cityCoord = toCoord(cityObj);
    if (cityCoord) return cityCoord;
  }

  const stateCoord = toCoord(stateObj);
  if (stateCoord) return stateCoord;

  return toCoord(countryObj);
}

// Great-circle distance in kilometers (haversine formula).
function distanceKm(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

// Is `artisan` (country/state/city/latitude/longitude/service_radius_km)
// within travel range of `searchLocation` ({ lat, lng })? Returns null --
// not true/false -- when eligibility can't be determined (no resolvable
// artisan coordinate, or no configured service_radius_km), so callers can
// tell "outside radius" apart from "radius data unavailable" and fall back
// deliberately instead of silently defaulting either way.
function isWithinRadius(searchLocation, artisan) {
  if (!searchLocation) return null;
  if (artisan.service_radius_km == null) return null;
  const artisanLocation = resolveLocation(artisan);
  if (!artisanLocation) return null;
  return distanceKm(searchLocation, artisanLocation) <= artisan.service_radius_km;
}

module.exports = { normalize, resolveLocation, distanceKm, isWithinRadius, _allCitiesOfCountry: allCitiesOfCountry };
