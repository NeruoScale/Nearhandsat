// Radius-based search eligibility (README roadmap #2). Pure unit tests --
// no DB, no server -- against server/utils/geo.js, covering the exact
// boundary cases called out for this phase: distance 0, inside radius, on
// the radius, outside radius, missing/invalid coordinates, missing radius,
// a very small radius, and a very large radius.
const test = require("node:test");
const assert = require("node:assert/strict");
const { normalize, resolveLocation, distanceKm, isWithinRadius } = require("../utils/geo");

test("normalize: strips diacritics and case so 'Setif' matches the dataset's 'Sétif'", () => {
  assert.equal(normalize("Sétif"), normalize("Setif"));
  assert.equal(normalize("  BATNA "), "batna");
});

test("resolveLocation: resolves a known city (task's own example -- Algeria/Batna/Batna)", () => {
  const loc = resolveLocation({ country: "Algeria", state: "Batna", city: "Batna" });
  assert.ok(loc);
  assert.ok(Math.abs(loc.lat - 35.55597) < 0.01);
  assert.ok(Math.abs(loc.lng - 6.17414) < 0.01);
});

test("resolveLocation: resolves a city even when state is missing, via country-wide search", () => {
  const loc = resolveLocation({ country: "Algeria", city: "El Eulma" });
  assert.ok(loc);
});

test("resolveLocation: resolves a city despite a diacritic mismatch against the dataset", () => {
  const loc = resolveLocation({ country: "Algeria", city: "Setif" }); // dataset has "Sétif"
  assert.ok(loc);
});

test("resolveLocation: an artisan's own explicit latitude/longitude always wins over text resolution", () => {
  const loc = resolveLocation({ country: "Algeria", city: "Batna", latitude: 1.23, longitude: 4.56 });
  assert.equal(loc.lat, 1.23);
  assert.equal(loc.lng, 4.56);
});

test("resolveLocation: returns null for an unresolvable country/city", () => {
  assert.equal(resolveLocation({ country: "Nowhereland", city: "Nowhere" }), null);
  assert.equal(resolveLocation({}), null);
});

test("distanceKm: distance from a point to itself is 0", () => {
  const p = resolveLocation({ country: "Algeria", city: "Batna" });
  assert.equal(distanceKm(p, p), 0);
});

test("distanceKm: a known real-world pair is a plausible, non-trivial distance", () => {
  const setif = resolveLocation({ country: "Algeria", city: "Setif" });
  const elEulma = resolveLocation({ country: "Algeria", city: "El Eulma" });
  const d = distanceKm(setif, elEulma);
  assert.ok(d > 15 && d < 35, `expected ~25km between Setif and El Eulma, got ${d}`);
});

test("isWithinRadius: distance = 0 (same city) is eligible", () => {
  const search = resolveLocation({ country: "Algeria", city: "Batna" });
  const artisan = { country: "Algeria", state: "Batna", city: "Batna", service_radius_km: 30 };
  assert.equal(isWithinRadius(search, artisan), true);
});

test("isWithinRadius: distance below the radius is eligible", () => {
  const search = resolveLocation({ country: "Algeria", city: "Setif" });
  const artisan = { country: "Algeria", city: "El Eulma", service_radius_km: 50 }; // ~25km apart
  assert.equal(isWithinRadius(search, artisan), true);
});

test("isWithinRadius: distance beyond the radius is not eligible", () => {
  const search = resolveLocation({ country: "Algeria", city: "Setif" });
  const artisan = { country: "Algeria", city: "El Eulma", service_radius_km: 5 }; // ~25km apart, 5km radius
  assert.equal(isWithinRadius(search, artisan), false);
});

test("isWithinRadius: distance exactly equal to the radius is inclusive (eligible)", () => {
  const search = resolveLocation({ country: "Algeria", city: "Setif" });
  const artisan = { country: "Algeria", city: "El Eulma", latitude: null, longitude: null, service_radius_km: 999 };
  const artisanLoc = resolveLocation(artisan);
  const exact = distanceKm(search, artisanLoc);
  // Radius set to the exact real distance -- must still be eligible (<=, not <).
  assert.equal(isWithinRadius(search, { ...artisan, service_radius_km: exact }), true);
});

test("isWithinRadius: missing artisan coordinates (unresolvable location) returns null, not false", () => {
  const search = resolveLocation({ country: "Algeria", city: "Setif" });
  const artisan = { country: "Nowhereland", city: "Nowhere", service_radius_km: 20 };
  assert.equal(isWithinRadius(search, artisan), null);
});

test("isWithinRadius: missing service_radius_km returns null, not false", () => {
  const search = resolveLocation({ country: "Algeria", city: "Setif" });
  const artisan = { country: "Algeria", city: "El Eulma", service_radius_km: null };
  assert.equal(isWithinRadius(search, artisan), null);
});

test("isWithinRadius: no search location returns null", () => {
  const artisan = { country: "Algeria", city: "El Eulma", service_radius_km: 20 };
  assert.equal(isWithinRadius(null, artisan), null);
});

test("isWithinRadius: a very small radius (1km) excludes a ~25km-away artisan", () => {
  const search = resolveLocation({ country: "Algeria", city: "Setif" });
  const artisan = { country: "Algeria", city: "El Eulma", service_radius_km: 1 };
  assert.equal(isWithinRadius(search, artisan), false);
});

test("isWithinRadius: a very large radius (5000km) includes a ~25km-away artisan", () => {
  const search = resolveLocation({ country: "Algeria", city: "Setif" });
  const artisan = { country: "Algeria", city: "El Eulma", service_radius_km: 5000 };
  assert.equal(isWithinRadius(search, artisan), true);
});

test("isWithinRadius: radius = 0 only matches distance = 0", () => {
  const search = resolveLocation({ country: "Algeria", city: "Batna" });
  const sameCity = { country: "Algeria", state: "Batna", city: "Batna", service_radius_km: 0 };
  const otherCity = { country: "Algeria", city: "El Eulma", service_radius_km: 0 };
  assert.equal(isWithinRadius(search, sameCity), true);
  assert.equal(isWithinRadius(search, otherCity), false);
});
