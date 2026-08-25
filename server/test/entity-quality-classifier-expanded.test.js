// README roadmap #7E: tests for the expanded entity-quality classifier
// (franchise/chain + defunct/closed detection, layered on top of #7D's
// unchanged institutional/category-mismatch logic). Pure-function tests,
// no DB, no network. Every franchise case below was verified against a
// real #7C/#7D candidate's stored name/website before being added to
// FRANCHISE_BRANDS -- see entityQualityClassifier.js's header comment.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  classifyEntityQuality,
  detectFranchiseChain,
  detectDefunctClosed,
  classifyExpandedEntityQuality,
  isExcludedFromExpandedMetric,
  isExcludedFromCorrectedMetric,
} = require("../utils/entityQualityClassifier");

// --- Franchise: real #7C/#7D candidates ---

test("franchise: 'Pep Boys' (id 73, Atlanta) -> franchise_chain, high confidence", () => {
  const r = detectFranchiseChain({ displayName: "Pep Boys", categoryCode: "Auto Mechanic" });
  assert.equal(r.isFranchise, true);
  assert.equal(r.confidence, "high");
  assert.ok(r.reason);
});

test("franchise: 'Grease Monkey' (id 74, Atlanta) -> franchise_chain", () => {
  assert.equal(detectFranchiseChain({ displayName: "Grease Monkey", categoryCode: "Auto Mechanic" }).isFranchise, true);
});

test("franchise: 'Midas' (id 80, Miami) -> franchise_chain", () => {
  assert.equal(detectFranchiseChain({ displayName: "Midas", categoryCode: "Auto Mechanic" }).isFranchise, true);
});

test("franchise: 'Kwik Kar' (id 91, Dallas) -> franchise_chain", () => {
  assert.equal(detectFranchiseChain({ displayName: "Kwik Kar", categoryCode: "Auto Mechanic" }).isFranchise, true);
});

test("franchise: 'Havoline Express Lube' (id 77, Atlanta) -> franchise_chain", () => {
  assert.equal(detectFranchiseChain({ displayName: "Havoline Express Lube", categoryCode: "Auto Mechanic" }).isFranchise, true);
});

test("franchise: 'Safelite AutoGlass' (id 84, Miami), corroborated by stored website domain -> franchise_chain", () => {
  const r = detectFranchiseChain({ displayName: "Safelite AutoGlass", categoryCode: "Auto Mechanic", websiteDomain: "safelite.com" });
  assert.equal(r.isFranchise, true);
  assert.match(r.evidence, /safelite\.com/);
});

test("franchise: 'Goettl Air Conditioning & Plumbing' (id 61, Phoenix) -> franchise_chain", () => {
  assert.equal(detectFranchiseChain({ displayName: "Goettl Air Conditioning & Plumbing", categoryCode: "Plumber" }).isFranchise, true);
});

test("franchise: 'Frankies Mobil 1 Lube Express' (id 55, Houston) -> franchise_chain via the Mobil 1 Lube Express brand pattern", () => {
  assert.equal(detectFranchiseChain({ displayName: "Frankies Mobil 1 Lube Express", categoryCode: "Auto Mechanic" }).isFranchise, true);
});

// --- Franchise: false-positive protection ---

test("franchise: normal independent plumber is NOT automatically franchise", () => {
  const r = detectFranchiseChain({ displayName: "Rodding Rooter", categoryCode: "Plumber" });
  assert.equal(r.isFranchise, false);
});

test("franchise: generic business name -> not franchise (never guessed from a 'corporate-sounding' name alone)", () => {
  assert.equal(detectFranchiseChain({ displayName: "Premier Auto Solutions LLC", categoryCode: "Auto Mechanic" }).isFranchise, false);
});

test("franchise: a known auto-chain brand word does NOT fire for a DIFFERENT category (cross-category false-positive guard)", () => {
  // "Midas" is only in the Auto Mechanic brand list -- must not fire for Plumber/Electrician.
  assert.equal(detectFranchiseChain({ displayName: "Midas Plumbing Co", categoryCode: "Plumber" }).isFranchise, false);
});

test("franchise: no display name -> not franchise (not a guess, just nothing to match)", () => {
  const r = detectFranchiseChain({ displayName: null, categoryCode: "Auto Mechanic" });
  assert.equal(r.isFranchise, false);
  assert.equal(r.confidence, null);
});

// --- Defunct/closed ---

test("defunct: 'Location Closed' (id 76, Atlanta, the real #7D case) -> defunct_closed, high confidence", () => {
  const r = detectDefunctClosed({ displayName: "Location Closed" });
  assert.equal(r.isDefunct, true);
  assert.equal(r.confidence, "high");
});

test("defunct: explicit 'permanently closed' -> defunct_closed", () => {
  assert.equal(detectDefunctClosed({ displayName: "Joe's Plumbing - Permanently Closed" }).isDefunct, true);
});

test("defunct: 'defunct' / 'disused' / 'out of business' -> defunct_closed", () => {
  assert.equal(detectDefunctClosed({ displayName: "ABC Electric (defunct)" }).isDefunct, true);
  assert.equal(detectDefunctClosed({ displayName: "Old Shop (disused)" }).isDefunct, true);
  assert.equal(detectDefunctClosed({ displayName: "XYZ Auto - out of business" }).isDefunct, true);
});

test("defunct: a normal active-looking candidate is NOT flagged", () => {
  assert.equal(detectDefunctClosed({ displayName: "Damen Auto Repair" }).isDefunct, false);
});

test("defunct: missing website is NOT evidence of closure", () => {
  // detectDefunctClosed doesn't even take a website param -- confirms structurally
  // that absence of a field can never be used as closure evidence.
  const r = detectDefunctClosed({ displayName: "Nick's Auto Service" });
  assert.equal(r.isDefunct, false);
});

test("defunct: missing phone is NOT evidence of closure (same structural guarantee)", () => {
  const r = detectDefunctClosed({ displayName: "Brake Check" });
  assert.equal(r.isDefunct, false);
});

test("defunct: a business name that merely CONTAINS 'closed' as part of an unrelated word/phrase is not falsely flagged", () => {
  // "Closed Loop Plumbing" should not fire on a generic-sounding but
  // unrelated use of "closed" -- only the specific high-confidence
  // closure phrases in DEFUNCT_PATTERNS match.
  assert.equal(detectDefunctClosed({ displayName: "Closed Loop Plumbing Systems" }).isDefunct, false);
});

// --- Overlapping classifications / combined result ---

test("classifyExpandedEntityQuality: a franchise chain is NOT institutional and NOT a category mismatch (independent axes)", () => {
  const r = classifyExpandedEntityQuality({ displayName: "Pep Boys", categoryCode: "Auto Mechanic" });
  assert.equal(r.classification, "franchise_chain");
  assert.equal(r.categoryMismatch, false);
  assert.deepEqual(r.reasons.map((x) => x.type), ["franchise_chain"]);
  assert.equal(r.excluded, true);
});

test("classifyExpandedEntityQuality: a candidate that is BOTH institutional AND category-mismatched records both reasons", () => {
  const r = classifyExpandedEntityQuality({ displayName: "Upholstery Trade School", categoryCode: "Auto Mechanic" });
  assert.deepEqual(r.reasons.map((x) => x.type).sort(), ["category_mismatch", "institutional"]);
  assert.equal(r.excluded, true);
});

test("classifyExpandedEntityQuality: 'uncertain' (no name) has zero reasons and is NOT excluded", () => {
  const r = classifyExpandedEntityQuality({ displayName: null, categoryCode: "Plumber" });
  assert.equal(r.classification, "uncertain");
  assert.deepEqual(r.reasons, []);
  assert.equal(r.excluded, false);
});

test("classifyExpandedEntityQuality: a normal hireable business has zero reasons and is NOT excluded", () => {
  const r = classifyExpandedEntityQuality({ displayName: "Rodding Rooter", categoryCode: "Plumber" });
  assert.equal(r.classification, "likely_hireable");
  assert.deepEqual(r.reasons, []);
  assert.equal(r.excluded, false);
});

// --- Corrected metric denominator: overlap must not double-exclude ---

test("isExcludedFromExpandedMetric: excludes exactly once even when multiple reasons fired (no double-counting in a boolean)", () => {
  const r = classifyExpandedEntityQuality({ displayName: "Upholstery Trade School", categoryCode: "Auto Mechanic" });
  assert.equal(r.reasons.length, 2, "sanity check: two reasons did fire");
  assert.equal(isExcludedFromExpandedMetric(r), true, "but the exclusion boolean itself is a single true/false, not a count");
});

test("isExcludedFromExpandedMetric: never excludes uncertain", () => {
  const r = classifyExpandedEntityQuality({ displayName: "", categoryCode: "Electrician" });
  assert.equal(isExcludedFromExpandedMetric(r), false);
});

test("#7D's isExcludedFromCorrectedMetric remains usable and unchanged alongside the new #7E function (byte-identical #7D behavior preserved)", () => {
  const base = classifyEntityQuality({ displayName: "Plumbers Local 68", categoryCode: "Plumber" });
  assert.equal(isExcludedFromCorrectedMetric(base), true);
});

// --- Raw acquisition-ready must be untouched by any #7E logic ---

test("classifyEntityQuality (the #7D function) produces the exact same output regardless of #7E's additions -- raw/previous-corrected metrics are unaffected", () => {
  const r = classifyEntityQuality({ displayName: "Pep Boys", categoryCode: "Auto Mechanic" });
  // #7D never knew about franchises -- Pep Boys has no institutional keyword
  // and no category mismatch, so #7D's OWN classifier still says
  // likely_hireable, exactly as it would have before #7E existed.
  assert.equal(r.classification, "likely_hireable");
  assert.equal(r.categoryMismatch, false);
});

// --- Safety: no discovery, no network, no production ingestion coupling ---

test("safety: entityQualityClassifier.js source never calls fetch() and never imports anything from server/discovery/ -- structurally incapable of a network call or a discovery-pipeline coupling", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const source = fs.readFileSync(path.join(__dirname, "..", "utils", "entityQualityClassifier.js"), "utf8");
  assert.ok(!/\bfetch\s*\(/.test(source), "must not call fetch()");
  assert.ok(!/require\(["']\.\.\/discovery/.test(source), "must not import anything from server/discovery/");
});

test("safety: discovery/ingest.js does not import entityQualityClassifier -- production candidate ingestion never invokes the #7D/#7E classifier", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const source = fs.readFileSync(path.join(__dirname, "..", "discovery", "ingest.js"), "utf8");
  assert.ok(!/entityQualityClassifier/.test(source), "ingest.js must not reference entityQualityClassifier -- it is measurement-only, never part of the write path");
});

test("safety: running the expanded classifier over a whole sample set makes zero calls to a mocked global.fetch", async () => {
  const originalFetch = global.fetch;
  let fetchCalled = false;
  global.fetch = () => { fetchCalled = true; throw new Error("must never be called"); };
  try {
    const sample = [
      { displayName: "Pep Boys", categoryCode: "Auto Mechanic" },
      { displayName: "Location Closed", categoryCode: "Auto Mechanic" },
      { displayName: "Plumbers Local 68", categoryCode: "Plumber" },
      { displayName: null, categoryCode: "Electrician" },
    ];
    for (const c of sample) classifyExpandedEntityQuality(c);
    assert.equal(fetchCalled, false);
  } finally {
    global.fetch = originalFetch;
  }
});
