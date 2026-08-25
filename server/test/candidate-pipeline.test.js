// README roadmap #7A, Phase J: in-process tests for the candidate
// discovery pipeline (normalization, dedup, NearHandsAT-identity matching,
// ingestion). Deliberately does NOT call the real Overpass API -- a
// repeatable, CI-run test suite hitting a live third-party service on
// every run would itself be a form of "hammering a public service" over
// time, which #7A explicitly warns against. osmProvider.js's real-API
// integration was verified manually and separately (see the #7A final
// report); what's tested here is the pipeline logic around it, using a
// fake provider and real captured OSM response shapes.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

const DB_PATH = path.join(__dirname, `candidate-pipeline-test-${Date.now()}.db`);
process.env.DB_PATH = DB_PATH;
process.env.DB_DRIVER = "sqlite";
for (const suffix of ["", "-shm", "-wal"]) {
  try { fs.unlinkSync(DB_PATH + suffix); } catch {}
}

const db = require("../db-sqlite.js");
const normalize = require("../utils/normalize");
const { findDeterministicMatch, findProbableMatches } = require("../utils/candidateDedup");
const { findDeterministicUserMatch, findProbableUserMatches } = require("../utils/candidateIdentityMatch");
const ingestModule = require("../discovery/ingest");
const osmProvider = require("../discovery/providers/osmProvider");
const { TRADES } = require("../constants/trades");

test.after(() => {
  for (const suffix of ["", "-shm", "-wal"]) {
    try { fs.unlinkSync(DB_PATH + suffix); } catch {}
  }
});

// --- normalize.js ---

test("normalize: category matches an existing trade case/diacritic-insensitively, never guesses", () => {
  assert.equal(normalize.normalizeCategory("electrician"), "Electrician");
  assert.equal(normalize.normalizeCategory("  Plumber  "), "Plumber");
  assert.equal(normalize.normalizeCategory("not-a-real-trade"), null);
  assert.equal(normalize.normalizeCategory(""), null);
});

test("normalize: name collapses internal whitespace and diacritics for comparison, keeps distinct names distinct", () => {
  assert.equal(normalize.normalizeName("  Karim   Ferhat  "), normalize.normalizeName("Karîm Ferhat"));
  assert.notEqual(normalize.normalizeName("Karim Ferhat"), normalize.normalizeName("Karim Belkacem"));
});

test("normalize: phone strips formatting and normalizes the 00-prefix convention, rejects non-phone text", () => {
  assert.equal(normalize.normalizePhone("00213 555 123 456"), "+213555123456");
  assert.equal(normalize.normalizePhone("+213-555-123-456"), "+213555123456");
  assert.equal(normalize.normalizePhone("555.123.456"), "555123456");
  assert.equal(normalize.normalizePhone("abc"), null);
  assert.equal(normalize.normalizePhone(""), null);
});

test("normalize: website domain strips scheme/www/path, rejects unparsable input", () => {
  assert.equal(normalize.normalizeWebsiteDomain("https://www.Example.com/path?x=1"), "example.com");
  assert.equal(normalize.normalizeWebsiteDomain("example.dz"), "example.dz");
  assert.equal(normalize.normalizeWebsiteDomain(""), null);
});

// --- candidateDedup.js ---

test("dedup: deterministic match fires on phone, email, or website domain -- never on name alone", async () => {
  const info = await db
    .prepare(
      `INSERT INTO candidates (category_code, display_name, normalized_name, country, city, phone_normalized, email, website_domain, status)
       VALUES ('Electrician','Acme Elec','acme elec','Algeria','Setif','+213555000001','acme@example.com','acme-elec.dz','discovered')`
    )
    .run();
  const candidateId = info.lastInsertRowid;

  const byPhone = await findDeterministicMatch(db, { phone_normalized: "+213555000001" });
  assert.equal(byPhone.candidate.id, candidateId);
  assert.equal(byPhone.signal, "phone");

  const byEmail = await findDeterministicMatch(db, { email: "ACME@example.com" });
  assert.equal(byEmail.candidate.id, candidateId);

  const byDomain = await findDeterministicMatch(db, { website_domain: "acme-elec.dz" });
  assert.equal(byDomain.candidate.id, candidateId);

  const noSignals = await findDeterministicMatch(db, { normalized_name: "acme elec" });
  assert.equal(noSignals, null, "name alone must never produce a deterministic match");
});

test("dedup: probable match requires name + category + (city or proximity), not name alone", async () => {
  await db
    .prepare(
      `INSERT INTO candidates (category_code, display_name, normalized_name, country, city, status)
       VALUES ('Plumber','Ali Plomberie','ali plomberie','Algeria','Setif','discovered')`
    )
    .run();

  const matchSameCityAndCategory = await findProbableMatches(db, {
    normalized_name: "ali plomberie",
    category_code: "Plumber",
    country: "Algeria",
    city: "Setif",
  });
  assert.equal(matchSameCityAndCategory.length, 1);
  assert.deepEqual(matchSameCityAndCategory[0].signals, ["name", "category", "city"]);

  const noMatchDifferentCategory = await findProbableMatches(db, {
    normalized_name: "ali plomberie",
    category_code: "Electrician",
    country: "Algeria",
    city: "Setif",
  });
  assert.equal(noMatchDifferentCategory.length, 0, "category must agree, not just name");

  const noMatchNoCategory = await findProbableMatches(db, { normalized_name: "ali plomberie", country: "Algeria", city: "Setif" });
  assert.equal(noMatchNoCategory.length, 0, "name alone (no category_code) must never match");
});

// --- candidateIdentityMatch.js ---

test("identity match: deterministic phone match against a real NearHandsAT user, read-only", async () => {
  await db.prepare("UPDATE users SET phone = '+213555999000' WHERE email = 'artisan1@example.com'").run();
  const before = await db.prepare("SELECT * FROM users WHERE email = 'artisan1@example.com'").get();

  const match = await findDeterministicUserMatch(db, { phone: "+213 555 999 000" });
  assert.equal(match.user.id, before.id);
  assert.deepEqual(match.signals, ["phone"]);

  const after = await db.prepare("SELECT * FROM users WHERE email = 'artisan1@example.com'").get();
  assert.deepEqual(after, before, "identity matching must never modify the matched user");
});

test("identity match: probable match requires name + trade + city together", async () => {
  const artisan = await db.prepare("SELECT u.name, u.email, p.trade, p.city FROM users u JOIN artisan_profiles p ON p.user_id = u.id WHERE u.email = 'artisan1@example.com'").get();
  const matches = await findProbableUserMatches(db, {
    display_name: artisan.name,
    category_code: artisan.trade,
    city: artisan.city,
  });
  assert.ok(matches.some((m) => m.user.email === "artisan1@example.com"));

  const noMatch = await findProbableUserMatches(db, { display_name: artisan.name, category_code: "Painter", city: artisan.city });
  assert.equal(noMatch.length, 0, "trade must agree, not just name");
});

// --- osmProvider.js (no network) ---

test("osmProvider: every TRADES entry has an explicit mapping decision (never silently unmapped)", () => {
  for (const trade of TRADES) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(osmProvider.OSM_TAG_BY_CATEGORY, trade),
      `TRADES entry "${trade}" has no entry (not even an explicit null) in OSM_TAG_BY_CATEGORY`
    );
  }
});

test("osmProvider: a category with no confident tag mapping returns [] without making any network request", async () => {
  const originalFetch = global.fetch;
  global.fetch = () => { throw new Error("discover() must not call fetch for an unmapped category"); };
  try {
    const results = await osmProvider.discover({ countryName: "Algeria", categoryCode: "Cleaner", limit: 5 });
    assert.deepEqual(results, []);
  } finally {
    global.fetch = originalFetch;
  }
});

test("osmProvider: an unresolvable country name returns [] without making any network request", async () => {
  const originalFetch = global.fetch;
  global.fetch = () => { throw new Error("discover() must not call fetch for an unresolvable country"); };
  try {
    const results = await osmProvider.discover({ countryName: "Not A Real Country", categoryCode: "Plumber", limit: 5 });
    assert.deepEqual(results, []);
  } finally {
    global.fetch = originalFetch;
  }
});

// --- README roadmap #7D: verifyAreaBoundary (offline, mocked fetch) ---

test("osmProvider.verifyAreaBoundary: missing city or areaAdminLevel is rejected without any network call", async () => {
  const originalFetch = global.fetch;
  global.fetch = () => { throw new Error("must not call fetch when required params are missing"); };
  try {
    assert.equal((await osmProvider.verifyAreaBoundary(null, 8)).verified, false);
    assert.equal((await osmProvider.verifyAreaBoundary("Chicago", null)).verified, false);
  } finally {
    global.fetch = originalFetch;
  }
});

test("osmProvider.verifyAreaBoundary: a real element in the response means verified=true", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => ({ elements: [{ type: "node", id: 123 }] }) });
  try {
    const result = await osmProvider.verifyAreaBoundary("Chicago", 8);
    assert.equal(result.verified, true);
    assert.equal(result.reason, null);
  } finally {
    global.fetch = originalFetch;
  }
});

test("osmProvider.verifyAreaBoundary: zero elements means verified=false with an explanatory reason -- never silently treated as success", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => ({ elements: [] }) });
  try {
    const result = await osmProvider.verifyAreaBoundary("Not A Real Place", 8);
    assert.equal(result.verified, false);
    assert.ok(result.reason);
  } finally {
    global.fetch = originalFetch;
  }
});

test("osmProvider.verifyAreaBoundary: a non-OK HTTP response is reported as a failure, not thrown uncaught", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 429 });
  try {
    const result = await osmProvider.verifyAreaBoundary("Chicago", 8);
    assert.equal(result.verified, false);
    assert.match(result.reason, /429/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("osmProvider.verifyAreaBoundary: a network error is caught and reported, not thrown", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => { throw new Error("simulated network failure"); };
  try {
    const result = await osmProvider.verifyAreaBoundary("Chicago", 8);
    assert.equal(result.verified, false);
    assert.match(result.reason, /simulated network failure/);
  } finally {
    global.fetch = originalFetch;
  }
});

// --- ingest.js (fake provider, real dedup/matching/storage logic) ---

function fakeOsmRecord(overrides = {}) {
  return {
    provider: "osm",
    external_id: `node/${Math.floor(Math.random() * 1e9)}`,
    display_name: null,
    category_code: "Electrician",
    country: "Algeria",
    state: null,
    city: "Setif",
    address_raw: null,
    latitude: null,
    longitude: null,
    phone: null,
    email: null,
    website: null,
    license: "ODbL",
    source_url: "https://www.openstreetmap.org/node/x",
    raw_payload: null,
    ...overrides,
  };
}

test("ingest: creates a new candidate with a source row and a discovered event", async () => {
  const record = fakeOsmRecord({ display_name: "Fresh Sparky", external_id: "node/ingest-1" });
  ingestModule.PROVIDERS.fakeIngestTest1 = { discover: async () => [record] };

  const summary = await ingestModule.ingestCandidates(db, {
    provider: "fakeIngestTest1",
    countryName: "Algeria",
    categoryCode: "Electrician",
    limit: 5,
  });
  assert.equal(summary.newCandidates, 1);
  assert.equal(summary.mergedIntoExisting, 0);

  const candidate = await db.prepare("SELECT * FROM candidates WHERE id = ?").get(summary.candidateIds[0]);
  assert.equal(candidate.display_name, "Fresh Sparky");
  assert.equal(candidate.status, "discovered");

  const sources = await db.prepare("SELECT * FROM candidate_sources WHERE candidate_id = ?").all(candidate.id);
  assert.equal(sources.length, 1);
  assert.equal(sources[0].external_id, "node/ingest-1");

  const events = await db.prepare("SELECT event_type FROM candidate_events WHERE candidate_id = ?").all(candidate.id);
  assert.ok(events.some((e) => e.event_type === "discovered"));
});

test("ingest: re-ingesting the exact same source record merges into the existing candidate instead of duplicating it", async () => {
  const record = fakeOsmRecord({ display_name: null, external_id: "node/ingest-2" }); // no name/phone/email/website on purpose
  ingestModule.PROVIDERS.fakeIngestTest2 = { discover: async () => [record] };

  const first = await ingestModule.ingestCandidates(db, { provider: "fakeIngestTest2", countryName: "Algeria", categoryCode: "Electrician", limit: 5 });
  assert.equal(first.newCandidates, 1);

  const second = await ingestModule.ingestCandidates(db, { provider: "fakeIngestTest2", countryName: "Algeria", categoryCode: "Electrician", limit: 5 });
  assert.equal(second.newCandidates, 0, "must not create a second candidate row for the same source record");
  assert.equal(second.mergedIntoExisting, 1);
  assert.equal(second.candidateIds[0], first.candidateIds[0]);

  const sources = await db.prepare("SELECT * FROM candidate_sources WHERE candidate_id = ?").all(first.candidateIds[0]);
  assert.equal(sources.length, 1, "the source row must not be duplicated either");

  const events = await db.prepare("SELECT event_type FROM candidate_events WHERE candidate_id = ? ORDER BY id").all(first.candidateIds[0]);
  assert.deepEqual(events.map((e) => e.event_type), ["discovered", "re_discovered"]);
});

test("ingest: two candidates with the same name/category/city are flagged as probable duplicates on both sides, never auto-merged", async () => {
  const recordA = fakeOsmRecord({ display_name: "Bilal Menuiserie", category_code: "Carpenter", external_id: "node/probA" });
  const recordB = fakeOsmRecord({ display_name: "Bilal  Menuiserie", category_code: "Carpenter", external_id: "node/probB" });
  ingestModule.PROVIDERS.fakeIngestTest3 = { discover: async () => [recordA, recordB] };

  const summary = await ingestModule.ingestCandidates(db, { provider: "fakeIngestTest3", countryName: "Algeria", categoryCode: "Carpenter", limit: 5 });
  assert.equal(summary.newCandidates, 2, "both stay as separate candidate rows -- never silently merged on a probable signal");
  assert.equal(summary.probableDuplicatesFlagged, 1);

  const [idA, idB] = summary.candidateIds;
  const candidateA = await db.prepare("SELECT status FROM candidates WHERE id = ?").get(idA);
  assert.equal(candidateA.status, "discovered", "a probable match must not change status automatically");

  const eventsA = await db.prepare("SELECT * FROM candidate_events WHERE candidate_id = ? AND event_type = 'probable_duplicate_flagged'").all(idA);
  const eventsB = await db.prepare("SELECT * FROM candidate_events WHERE candidate_id = ? AND event_type = 'probable_duplicate_flagged'").all(idB);
  assert.equal(eventsA.length, 1, "flagged on the first candidate");
  assert.equal(eventsB.length, 1, "flagged on the second candidate too");
});

test("ingest: a candidate matching a real user's phone logs identity_match_found without touching the user or the candidate beyond the log", async () => {
  await db.prepare("UPDATE users SET phone = '+213555777000' WHERE email = 'artisan2@example.com'").run();
  const userBefore = await db.prepare("SELECT * FROM users WHERE email = 'artisan2@example.com'").get();

  const record = fakeOsmRecord({ display_name: "Coincidental Match", phone: "+213 555 777 000", external_id: "node/idmatch" });
  ingestModule.PROVIDERS.fakeIngestTest4 = { discover: async () => [record] };

  const summary = await ingestModule.ingestCandidates(db, { provider: "fakeIngestTest4", countryName: "Algeria", categoryCode: "Electrician", limit: 5 });
  assert.equal(summary.identityMatchesFound, 1);

  const userAfter = await db.prepare("SELECT * FROM users WHERE email = 'artisan2@example.com'").get();
  assert.deepEqual(userAfter, userBefore, "the matched user must be completely untouched");

  const candidate = await db.prepare("SELECT status FROM candidates WHERE id = ?").get(summary.candidateIds[0]);
  assert.equal(candidate.status, "discovered", "an identity match must not change the candidate's status automatically");

  const events = await db.prepare("SELECT detail FROM candidate_events WHERE candidate_id = ? AND event_type = 'identity_match_found'").all(summary.candidateIds[0]);
  assert.equal(events.length, 1);
  const detail = JSON.parse(events[0].detail);
  assert.equal(detail.matched_user_id, userBefore.id);
  assert.equal(detail.confidence, "deterministic");
});

test("ingest: candidates table has no foreign key column to users or artisan_profiles", async () => {
  const cols = await db.prepare("PRAGMA table_info(candidates)").all();
  const colNames = cols.map((c) => c.name);
  assert.ok(!colNames.includes("user_id"));
  assert.ok(!colNames.includes("artisan_id"));
});
