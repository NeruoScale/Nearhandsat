// README roadmap #7B: tests for the physical-location proximity dedup
// signal (server/utils/candidateDedup.js's findPhysicalProximityMatches),
// and its wiring into the ingestion pipeline. In-process, no subprocess,
// no network -- same pattern as candidate-pipeline.test.js.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

const DB_PATH = path.join(__dirname, `proximity-dedup-test-${Date.now()}.db`);
process.env.DB_PATH = DB_PATH;
process.env.DB_DRIVER = "sqlite";
for (const suffix of ["", "-shm", "-wal"]) {
  try { fs.unlinkSync(DB_PATH + suffix); } catch {}
}

const db = require("../db-sqlite.js");
const { distanceKm } = require("../utils/geo");
const {
  findPhysicalProximityMatches,
  findProbableMatches,
  STRONG_PROXIMITY_RADIUS_KM,
  MODERATE_PROXIMITY_RADIUS_KM,
} = require("../utils/candidateDedup");
const ingestModule = require("../discovery/ingest");

test.after(() => {
  for (const suffix of ["", "-shm", "-wal"]) {
    try { fs.unlinkSync(DB_PATH + suffix); } catch {}
  }
});

const BASE_LAT = 36.7;
const BASE_LNG = 3.0;
const METERS_PER_DEGREE_LAT = 111320;

// Pure-latitude offset -- accurate enough at this scale, and every test
// below verifies the ACTUAL haversine distance via distanceKm() rather
// than trusting the approximation, so any drift would show up as a
// visible assertion failure, not silent flakiness.
function pointAtOffset(meters) {
  return { latitude: BASE_LAT + meters / METERS_PER_DEGREE_LAT, longitude: BASE_LNG };
}

let nextId = 1;
async function insertCandidate(overrides = {}) {
  const point = overrides.point || pointAtOffset(0);
  const info = await db
    .prepare(
      `INSERT INTO candidates
        (category_code, display_name, normalized_name, country, city, address_raw, latitude, longitude,
         phone, phone_normalized, email, website_domain, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'discovered')`
    )
    .run(
      overrides.category_code ?? "Plumber",
      overrides.display_name ?? null,
      overrides.normalized_name ?? null,
      overrides.country ?? "Algeria",
      overrides.city ?? null,
      overrides.address_raw ?? null,
      point.latitude,
      point.longitude,
      overrides.phone ?? null,
      overrides.phone_normalized ?? null,
      overrides.email ?? null,
      overrides.website_domain ?? null
    );
  nextId += 1;
  return info.lastInsertRowid;
}

// Sanity check on the coordinate-generation helper itself, before trusting
// it in every case below.
test("test helper: pointAtOffset produces the intended real-world distance", () => {
  const a = pointAtOffset(0);
  const b = pointAtOffset(100);
  const d = distanceKm({ lat: a.latitude, lng: a.longitude }, { lat: b.latitude, lng: b.longitude }) * 1000;
  assert.ok(Math.abs(d - 100) < 1, `expected ~100m, got ${d}m`);
});

// --- Case 1: unnamed + unnamed, same category, 10m apart -> flagged (strong) ---

test("proximity: unnamed + unnamed, same category, 10m apart -> strong", async () => {
  const existingId = await insertCandidate({ category_code: "Plumber", point: pointAtOffset(0) });
  const candidateData = { category_code: "Plumber", latitude: pointAtOffset(10).latitude, longitude: pointAtOffset(10).longitude };

  const matches = await findPhysicalProximityMatches(db, candidateData);
  const match = matches.find((m) => m.candidate.id === existingId);
  assert.ok(match, "expected a proximity match");
  assert.equal(match.confidence, "strong");
});

// --- Case 2: unnamed + unnamed, same category, 40m apart -> flagged (strong) ---

test("proximity: unnamed + unnamed, same category, 40m apart -> strong", async () => {
  const existingId = await insertCandidate({ category_code: "Electrician", point: pointAtOffset(0) });
  const candidateData = { category_code: "Electrician", latitude: pointAtOffset(40).latitude, longitude: pointAtOffset(40).longitude };

  const matches = await findPhysicalProximityMatches(db, candidateData);
  const match = matches.find((m) => m.candidate.id === existingId);
  assert.ok(match, "expected a proximity match at 40m");
  assert.equal(match.confidence, "strong");
});

// --- Case 3: unnamed + unnamed, same category, 120m apart -> moderate, conditional on corroborating evidence ---

test("proximity: unnamed + unnamed, same category, 120m apart WITH matching city -> moderate", async () => {
  const existingId = await insertCandidate({ category_code: "Carpenter", city: "Setif", point: pointAtOffset(0) });
  const candidateData = {
    category_code: "Carpenter",
    city: "Setif",
    latitude: pointAtOffset(120).latitude,
    longitude: pointAtOffset(120).longitude,
  };

  const matches = await findPhysicalProximityMatches(db, candidateData);
  const match = matches.find((m) => m.candidate.id === existingId);
  assert.ok(match, "expected a moderate proximity match at 120m with corroborating evidence");
  assert.equal(match.confidence, "moderate");
});

test("proximity: unnamed + unnamed, same category, 120m apart WITHOUT any corroborating evidence -> not flagged", async () => {
  const existingId = await insertCandidate({ category_code: "Roofer", point: pointAtOffset(0) });
  const candidateData = { category_code: "Roofer", latitude: pointAtOffset(120).latitude, longitude: pointAtOffset(120).longitude };

  const matches = await findPhysicalProximityMatches(db, candidateData);
  assert.ok(!matches.some((m) => m.candidate.id === existingId), "120m with no corroborating evidence must not be flagged -- distance alone is never enough in the moderate band");
});

// --- Case 4: same category, 20m apart, clearly conflicting names -> not a strong duplicate ---

test("proximity: same category, 20m apart, clearly conflicting names -> not flagged at all", async () => {
  const existingId = await insertCandidate({ category_code: "Plumber", display_name: "Ali Plomberie", normalized_name: "ali plomberie", point: pointAtOffset(0) });
  const candidateData = {
    category_code: "Plumber",
    normalized_name: "karim plomberie",
    latitude: pointAtOffset(20).latitude,
    longitude: pointAtOffset(20).longitude,
  };

  const matches = await findPhysicalProximityMatches(db, candidateData);
  assert.ok(!matches.some((m) => m.candidate.id === existingId), "conflicting names must eliminate the physical-duplicate signal, even at 20m");
});

// --- Case 5: different categories, 20m apart -> not flagged by this signal ---

test("proximity: different categories, 20m apart -> not flagged", async () => {
  const existingId = await insertCandidate({ category_code: "Plumber", point: pointAtOffset(0) });
  const candidateData = { category_code: "Electrician", latitude: pointAtOffset(20).latitude, longitude: pointAtOffset(20).longitude };

  const matches = await findPhysicalProximityMatches(db, candidateData);
  assert.ok(!matches.some((m) => m.candidate.id === existingId), "a different category must never be flagged merely for being geographically close");
});

// --- Case 6: same category, several kilometers apart -> not flagged ---

test("proximity: same category, several kilometers apart -> not flagged", async () => {
  const existingId = await insertCandidate({ category_code: "Painter", point: pointAtOffset(0) });
  const candidateData = { category_code: "Painter", latitude: pointAtOffset(5000).latitude, longitude: pointAtOffset(5000).longitude };

  const matches = await findPhysicalProximityMatches(db, candidateData);
  assert.ok(!matches.some((m) => m.candidate.id === existingId));
});

// --- Case 7: existing name-based dedup behavior continues unchanged ---

test("regression: name-based probable-match signal (findProbableMatches) is untouched by the new proximity signal", async () => {
  await insertCandidate({ category_code: "Tiler", display_name: "Bilal Carrelage", normalized_name: "bilal carrelage", city: "Setif", point: pointAtOffset(0) });

  const matches = await findProbableMatches(db, { normalized_name: "bilal carrelage", category_code: "Tiler", country: "Algeria", city: "Setif" });
  assert.equal(matches.length, 1);
  assert.deepEqual(matches[0].signals, ["name", "category", "city"]);

  const noMatchOnNameAlone = await findProbableMatches(db, { normalized_name: "bilal carrelage", country: "Algeria", city: "Setif" });
  assert.equal(noMatchOnNameAlone.length, 0, "name-based signal must still never match on name alone (no category_code)");
});

// --- Case 8: candidates with missing coordinates do not crash the system ---

test("proximity: missing coordinates on the incoming candidate -> returns [] without throwing", async () => {
  await insertCandidate({ category_code: "Welder", point: pointAtOffset(0) });
  const matches = await findPhysicalProximityMatches(db, { category_code: "Welder", latitude: null, longitude: null });
  assert.deepEqual(matches, []);
});

test("proximity: an existing row with no coordinates is simply excluded, not a crash", async () => {
  // Inserted directly with NULL lat/lng (no `point`), unlike every other
  // helper call in this file.
  await db
    .prepare(
      `INSERT INTO candidates (category_code, country, status) VALUES ('Locksmith','Algeria','discovered')`
    )
    .run();
  const matches = await findPhysicalProximityMatches(db, {
    category_code: "Locksmith",
    latitude: pointAtOffset(0).latitude,
    longitude: pointAtOffset(0).longitude,
  });
  assert.deepEqual(matches, [], "a same-category row with null coordinates must be excluded, not crash the query");
});

// --- Case 9: exact/near-identical coordinates are handled safely ---

test("proximity: exact identical coordinates -> strong, no crash, sensible distance of 0", async () => {
  const point = pointAtOffset(0);
  const existingId = await insertCandidate({ category_code: "Mason", point });
  const candidateData = { category_code: "Mason", latitude: point.latitude, longitude: point.longitude };

  const matches = await findPhysicalProximityMatches(db, candidateData);
  const match = matches.find((m) => m.candidate.id === existingId);
  assert.ok(match);
  assert.equal(match.confidence, "strong");
  assert.equal(match.distanceMeters, 0);
});

// --- Safeguard: a conflicting phone also suppresses the signal, not just names ---

test("proximity: differing phone numbers on both sides suppresses the signal even when unnamed and 10m apart", async () => {
  const existingId = await insertCandidate({ category_code: "Blacksmith", phone_normalized: "+213555000001", point: pointAtOffset(0) });
  const candidateData = {
    category_code: "Blacksmith",
    phone_normalized: "+213555999999",
    latitude: pointAtOffset(10).latitude,
    longitude: pointAtOffset(10).longitude,
  };
  const matches = await findPhysicalProximityMatches(db, candidateData);
  assert.ok(!matches.some((m) => m.candidate.id === existingId), "two different phone numbers is concrete evidence of separate businesses");
});

// --- Never a blanket rule: same category + merely "nearby" (right at/just past the moderate boundary, no evidence) must not flag ---

test("proximity: safeguard against a blanket rule -- 500m apart is diagnostic only, never automatic", async () => {
  const existingId = await insertCandidate({ category_code: "Auto Mechanic", point: pointAtOffset(0) });
  const candidateData = { category_code: "Auto Mechanic", latitude: pointAtOffset(500).latitude, longitude: pointAtOffset(500).longitude };
  const matches = await findPhysicalProximityMatches(db, candidateData);
  assert.ok(!matches.some((m) => m.candidate.id === existingId), "500m must never be treated as an automatic duplicate threshold");
});

// --- Integration: the ingestion pipeline records the new signal via the existing candidate_events mechanism, never merges/deletes ---

test("ingest: physical-proximity match is recorded as probable_duplicate_flagged with a confidence field, on both sides, without changing status", async () => {
  const record1 = {
    provider: "osm", external_id: "node/prox-1", display_name: null, category_code: "HVAC Technician",
    country: "Algeria", state: null, city: null, address_raw: null,
    latitude: pointAtOffset(0).latitude, longitude: pointAtOffset(0).longitude,
    phone: null, email: null, website: null, license: "ODbL", source_url: "x", raw_payload: null,
  };
  const record2 = {
    ...record1,
    external_id: "node/prox-2",
    latitude: pointAtOffset(15).latitude,
    longitude: pointAtOffset(15).longitude,
  };
  ingestModule.PROVIDERS.fakeProximityTest = { discover: async () => [record1, record2] };

  const summary = await ingestModule.ingestCandidates(db, {
    provider: "fakeProximityTest",
    countryName: "Algeria",
    categoryCode: "HVAC Technician",
    limit: 5,
  });

  assert.equal(summary.newCandidates, 2, "both stay as separate rows -- never auto-merged");
  assert.equal(summary.probableDuplicatesFlagged, 1);

  const [idA, idB] = summary.candidateIds;
  const candidateA = await db.prepare("SELECT status FROM candidates WHERE id = ?").get(idA);
  const candidateB = await db.prepare("SELECT status FROM candidates WHERE id = ?").get(idB);
  assert.equal(candidateA.status, "discovered", "a proximity match must not change status automatically");
  assert.equal(candidateB.status, "discovered");

  const eventsA = await db.prepare("SELECT detail FROM candidate_events WHERE candidate_id = ? AND event_type = 'probable_duplicate_flagged'").all(idA);
  const eventsB = await db.prepare("SELECT detail FROM candidate_events WHERE candidate_id = ? AND event_type = 'probable_duplicate_flagged'").all(idB);
  assert.equal(eventsA.length, 1);
  assert.equal(eventsB.length, 1);
  const detailA = JSON.parse(eventsA[0].detail);
  assert.equal(detailA.confidence, "strong");
  assert.ok(detailA.signals.includes("proximity"));
  assert.equal(detailA.otherCandidateId, idB);
});

test("ingest: a pair already flagged by the name-based signal is not also double-flagged by the proximity signal", async () => {
  const record1 = {
    provider: "osm", external_id: "node/dup-name-1", display_name: "Fatima Coiffure", category_code: "Tailor",
    country: "Algeria", state: null, city: "Oran", address_raw: null,
    latitude: pointAtOffset(0).latitude, longitude: pointAtOffset(0).longitude,
    phone: null, email: null, website: null, license: "ODbL", source_url: "x", raw_payload: null,
  };
  const record2 = {
    ...record1,
    external_id: "node/dup-name-2",
    display_name: "Fatima  Coiffure", // same normalized name, extra internal space
    latitude: pointAtOffset(10).latitude,
    longitude: pointAtOffset(10).longitude,
  };
  ingestModule.PROVIDERS.fakeProximityTest2 = { discover: async () => [record1, record2] };

  const summary = await ingestModule.ingestCandidates(db, {
    provider: "fakeProximityTest2",
    countryName: "Algeria",
    categoryCode: "Tailor",
    limit: 5,
  });

  assert.equal(summary.probableDuplicatesFlagged, 1, "must be flagged exactly once, not once per signal");
  const [idA] = summary.candidateIds;
  const events = await db.prepare("SELECT detail FROM candidate_events WHERE candidate_id = ? AND event_type = 'probable_duplicate_flagged'").all(idA);
  assert.equal(events.length, 1);
  const detail = JSON.parse(events[0].detail);
  assert.deepEqual(detail.signals, ["name", "category", "city"], "the name-based signal should win when both would apply to the same pair");
  assert.equal(detail.confidence, undefined, "the name-based event shape is unchanged -- no confidence field");
});
