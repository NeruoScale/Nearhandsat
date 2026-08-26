// README roadmap #8B: tests for the OSM entity-type validator
// (server/utils/osmEntityTypeValidator.js). Pure-function tests, entirely
// offline -- every fixture is a synthetic OSM element/metadata object,
// never a live Overpass call, never a read of the historical 62
// #7C/#7D candidates (which predate #8A's richer capture and are not
// retrofitted).
const test = require("node:test");
const assert = require("node:assert/strict");
const { validateOsmEntityType } = require("../utils/osmEntityTypeValidator");

function osm(tags, type = "node", id = 1, category_signal = null) {
  return { type, id, category_signal, tags };
}

// --- Business evidence ---

test("business: shop=car_repair -> business_candidate, high confidence", () => {
  const r = validateOsmEntityType(osm({ shop: "car_repair" }));
  assert.equal(r.classification, "business_candidate");
  assert.equal(r.confidence, "high");
});

test("business: craft=electrician -> business_candidate, high confidence", () => {
  const r = validateOsmEntityType(osm({ craft: "electrician" }));
  assert.equal(r.classification, "business_candidate");
  assert.equal(r.confidence, "high");
});

test("business: office=company (non-institutional value) -> business_candidate", () => {
  const r = validateOsmEntityType(osm({ office: "company" }));
  assert.equal(r.classification, "business_candidate");
});

test("business: only moderate-strength tags (e.g. leisure) -> business_candidate at medium confidence, not high", () => {
  const r = validateOsmEntityType(osm({ leisure: "fitness_centre" }));
  assert.equal(r.classification, "business_candidate");
  assert.equal(r.confidence, "medium");
});

// --- Institutional evidence ---

test("institutional: amenity=school -> institutional, high confidence", () => {
  const r = validateOsmEntityType(osm({ amenity: "school" }));
  assert.equal(r.classification, "institutional");
  assert.equal(r.confidence, "high");
});

test("institutional: amenity=university / college / kindergarten -> institutional", () => {
  assert.equal(validateOsmEntityType(osm({ amenity: "university" })).classification, "institutional");
  assert.equal(validateOsmEntityType(osm({ amenity: "college" })).classification, "institutional");
  assert.equal(validateOsmEntityType(osm({ amenity: "kindergarten" })).classification, "institutional");
});

test("institutional: office=government / office=association -> institutional", () => {
  assert.equal(validateOsmEntityType(osm({ office: "government" })).classification, "institutional");
  assert.equal(validateOsmEntityType(osm({ office: "association" })).classification, "institutional");
});

test("institutional: social_facility key (any value) -> institutional", () => {
  const r = validateOsmEntityType(osm({ social_facility: "nursing_home" }));
  assert.equal(r.classification, "institutional");
});

// README roadmap #8C: a real, live Overpass sample (Houston, Plumber
// category) returned two nodes tagged craft=plumber + office=union -- a
// plumbers' union office, the same real-world entity type as #7C/#7D's
// historical "Plumbers Local 68" candidate. Before this fix, the
// validator classified both as business_candidate (craft=plumber alone
// was enough) despite the co-occurring office=union tag -- a genuine,
// live-data-demonstrated gap, not a hypothetical one.
test("institutional: office=union overrides a co-occurring craft=plumber tag (real #8C live-sample finding)", () => {
  const r = validateOsmEntityType(osm({ name: "Plumbers Local 68", craft: "plumber", office: "union" }));
  assert.equal(r.classification, "institutional");
  assert.equal(r.confidence, "high");
});

// --- Infrastructure / geographic evidence (the #7F gap) ---

test("infrastructure: highway=primary/secondary/residential -> infrastructure_or_geographic, high confidence", () => {
  assert.equal(validateOsmEntityType(osm({ highway: "primary" }, "way")).classification, "infrastructure_or_geographic");
  assert.equal(validateOsmEntityType(osm({ highway: "secondary" }, "way")).classification, "infrastructure_or_geographic");
  assert.equal(validateOsmEntityType(osm({ highway: "residential" }, "way")).classification, "infrastructure_or_geographic");
});

test("infrastructure: railway=rail -> infrastructure_or_geographic", () => {
  assert.equal(validateOsmEntityType(osm({ railway: "rail" }, "way")).classification, "infrastructure_or_geographic");
});

test("infrastructure: waterway=river -> infrastructure_or_geographic", () => {
  assert.equal(validateOsmEntityType(osm({ waterway: "river" }, "way")).classification, "infrastructure_or_geographic");
});

test("infrastructure: bridge=yes and junction=roundabout -> infrastructure_or_geographic", () => {
  assert.equal(validateOsmEntityType(osm({ bridge: "yes" }, "way")).classification, "infrastructure_or_geographic");
  assert.equal(validateOsmEntityType(osm({ junction: "roundabout" }, "way")).classification, "infrastructure_or_geographic");
});

test("infrastructure: confidence is high, never higher/lower than business evidence's own high tier (parity, not favoritism)", () => {
  const infra = validateOsmEntityType(osm({ highway: "primary" }, "way"));
  const biz = validateOsmEntityType(osm({ shop: "car_repair" }));
  assert.equal(infra.confidence, biz.confidence);
});

// --- Lifecycle evidence ---

test("lifecycle: disused=yes (bare) -> defunct_or_disused, medium confidence", () => {
  const r = validateOsmEntityType(osm({ shop: "car_repair", disused: "yes" }));
  assert.equal(r.classification, "defunct_or_disused");
  assert.equal(r.confidence, "medium");
});

test("lifecycle: disused:shop=car_repair (prefixed, tied to the category tag) -> defunct_or_disused, high confidence", () => {
  const r = validateOsmEntityType(osm({ shop: "car_repair", "disused:shop": "car_repair" }));
  assert.equal(r.classification, "defunct_or_disused");
  assert.equal(r.confidence, "high");
});

test("lifecycle: abandoned / demolished / construction / proposed all produce defunct_or_disused", () => {
  assert.equal(validateOsmEntityType(osm({ shop: "car_repair", abandoned: "yes" })).classification, "defunct_or_disused");
  assert.equal(validateOsmEntityType(osm({ shop: "car_repair", "demolished:shop": "car_repair" })).classification, "defunct_or_disused");
  assert.equal(validateOsmEntityType(osm({ shop: "car_repair", construction: "yes" })).classification, "defunct_or_disused");
  assert.equal(validateOsmEntityType(osm({ shop: "car_repair", proposed: "yes" })).classification, "defunct_or_disused");
});

test("lifecycle: no lifecycle tag present -> a normal business is NOT flagged defunct", () => {
  const r = validateOsmEntityType(osm({ shop: "car_repair" }));
  assert.notEqual(r.classification, "defunct_or_disused");
});

test("lifecycle: takes precedence over business evidence when both present (a business tag ALSO marked disused is not a current candidate)", () => {
  const r = validateOsmEntityType(osm({ craft: "electrician", disused: "yes" }));
  assert.equal(r.classification, "defunct_or_disused");
});

// --- Missing / empty metadata ---

test("missing metadata: {} -> uncertain, confidence 'none'", () => {
  const r = validateOsmEntityType(osm({}));
  assert.equal(r.classification, "uncertain");
  assert.equal(r.confidence, "none");
  assert.deepEqual(r.evidence, []);
});

test("missing metadata: undefined osmMetadata entirely -> uncertain, does not throw", () => {
  assert.doesNotThrow(() => validateOsmEntityType(undefined));
  assert.equal(validateOsmEntityType(undefined).classification, "uncertain");
});

test("missing metadata: osmMetadata with no `tags` key at all -> uncertain, does not throw", () => {
  const r = validateOsmEntityType({ type: "node", id: 1 });
  assert.equal(r.classification, "uncertain");
});

// --- Name-only evidence (the direct #7F / id 75 case) ---

test("name-only: display name present but NO structured tags -> uncertain, never infrastructure_or_geographic (id 75's real captured shape)", () => {
  const r = validateOsmEntityType(osm({ name: "Downtown Connector" }));
  assert.equal(r.classification, "uncertain");
  assert.notEqual(r.classification, "infrastructure_or_geographic");
});

test("name-only: an infrastructure-sounding name alone is never sufficient, regardless of how suggestive", () => {
  for (const name of ["Interstate 10", "River Park", "Downtown Connector", "Main Street Bridge"]) {
    const r = validateOsmEntityType(osm({ name }));
    assert.equal(r.classification, "uncertain", `"${name}" alone must not be classified`);
  }
});

test("name-only: the function does not even accept a name at the top level -- structurally cannot use it as evidence", () => {
  // Passing `name` outside `tags` (a misuse of the contract) still can't
  // influence the result, since validateOsmEntityType only ever reads
  // osmMetadata.tags.
  const r = validateOsmEntityType({ type: "node", id: 1, name: "Downtown Connector", tags: {} });
  assert.equal(r.classification, "uncertain");
});

// --- Structured evidence dominates name-only evidence ---

test("structured evidence wins: name='Downtown Connector' + shop=car_repair -> business_candidate (structured business evidence, name ignored)", () => {
  const r = validateOsmEntityType(osm({ name: "Downtown Connector", shop: "car_repair" }));
  assert.equal(r.classification, "business_candidate");
});

test("structured evidence wins: name='Downtown Connector' + highway=primary -> infrastructure_or_geographic (structured infra evidence corroborates the name, but the name itself is not why)", () => {
  const r = validateOsmEntityType(osm({ name: "Downtown Connector", highway: "primary" }, "way"));
  assert.equal(r.classification, "infrastructure_or_geographic");
});

// --- Conflicting evidence ---

test("conflict: business (shop) + infrastructure (highway) both present -> uncertain, not a guess either way", () => {
  const r = validateOsmEntityType(osm({ name: "ABC Auto Repair", shop: "car_repair", highway: "primary" }, "way"));
  assert.equal(r.classification, "uncertain");
  assert.ok(r.reasons[0].includes("conflicting"));
});

test("conflict: institutional + infrastructure both present -> uncertain", () => {
  const r = validateOsmEntityType(osm({ amenity: "school", highway: "residential" }, "way"));
  assert.equal(r.classification, "uncertain");
});

test("conflict: evidence array for a conflict includes both sides, for auditability", () => {
  const r = validateOsmEntityType(osm({ shop: "car_repair", highway: "primary" }, "way"));
  const keys = r.evidence.map((e) => e.key).sort();
  assert.deepEqual(keys, ["highway", "shop"]);
});

// --- Category provenance (preserved, never rewritten) ---

test("category provenance: the function does not read or alter category_signal -- it only informs the caller, never the classification logic", () => {
  const withSignal = validateOsmEntityType(osm({ shop: "car_repair" }, "node", 1, { key: "shop", value: "car_repair" }));
  const withoutSignal = validateOsmEntityType(osm({ shop: "car_repair" }, "node", 1, null));
  assert.equal(withSignal.classification, withoutSignal.classification);
  assert.equal(withSignal.confidence, withoutSignal.confidence);
});

// --- OSM node/way/relation ---

test("OSM object type (node/way/relation) does not itself change the classification -- only tags do", () => {
  const node = validateOsmEntityType(osm({ shop: "car_repair" }, "node"));
  const way = validateOsmEntityType(osm({ shop: "car_repair" }, "way"));
  const relation = validateOsmEntityType(osm({ shop: "car_repair" }, "relation"));
  assert.equal(node.classification, "business_candidate");
  assert.equal(way.classification, "business_candidate");
  assert.equal(relation.classification, "business_candidate");
});

// --- Determinism ---

test("determinism: identical input always produces an identical (deep-equal) result", () => {
  const input = osm({ shop: "car_repair", "addr:city": "Chicago" });
  const r1 = validateOsmEntityType(input);
  const r2 = validateOsmEntityType(JSON.parse(JSON.stringify(input)));
  assert.deepEqual(r1, r2);
});

// --- Unsupported/unknown tags never influence the result ---

test("unknown tags: a tag not in any evidence vocabulary is silently ignored, not treated as business or infrastructure evidence", () => {
  const r = validateOsmEntityType(osm({ some_random_unrecognized_tag: "value", another_one: "x" }));
  assert.equal(r.classification, "uncertain");
});

// --- Multiple structured tags of the SAME type (no double-counting issue) ---

test("multiple business tags together are all reported as evidence, still one classification result", () => {
  const r = validateOsmEntityType(osm({ shop: "car_repair", craft: "electrician" }));
  assert.equal(r.classification, "business_candidate");
  assert.equal(r.evidence.length, 2);
});

// --- Production safety: pure, no side effects, not wired into ingestion or the existing classifier ---

test("safety: the module has no fetch/DB/network dependency and is not imported by ingest.js or entityQualityClassifier.js", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const validatorSource = fs.readFileSync(path.join(__dirname, "..", "utils", "osmEntityTypeValidator.js"), "utf8");
  assert.ok(!/\bfetch\s*\(/.test(validatorSource));
  assert.ok(!/require\(["']\.\.\/discovery/.test(validatorSource));

  const ingestSource = fs.readFileSync(path.join(__dirname, "..", "discovery", "ingest.js"), "utf8");
  assert.ok(!/osmEntityTypeValidator/.test(ingestSource), "ingest.js must not invoke the #8B validator");

  const classifierSource = fs.readFileSync(path.join(__dirname, "..", "utils", "entityQualityClassifier.js"), "utf8");
  assert.ok(!/osmEntityTypeValidator/.test(classifierSource), "entityQualityClassifier.js must not (yet) consume the #8B validator -- capture/validation and classification remain separate per #8B's own mandate");
});

test("safety: repeated calls with mocked global.fetch confirm zero network calls", () => {
  const originalFetch = global.fetch;
  let called = false;
  global.fetch = () => { called = true; throw new Error("must never be called"); };
  try {
    validateOsmEntityType(osm({ shop: "car_repair" }));
    validateOsmEntityType(osm({ highway: "primary" }, "way"));
    validateOsmEntityType(osm({}));
    assert.equal(called, false);
  } finally {
    global.fetch = originalFetch;
  }
});
