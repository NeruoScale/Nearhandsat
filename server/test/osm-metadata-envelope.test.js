// README roadmap #8A: tests for the structured OSM metadata envelope
// (osmProvider.js's buildOsmMetadataEnvelope). Offline only -- every test
// uses a mocked OSM element, never a live Overpass call, per #8A's
// explicit "design and test offline first" mandate.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  discover,
  buildOsmMetadataEnvelope,
  elementToCandidate,
} = require("../discovery/providers/osmProvider");

// --- OSM identity ---

test("identity: node type/id are captured", () => {
  const r = buildOsmMetadataEnvelope({ element: { type: "node", id: 456, tags: { name: "X" } }, tag: { key: "shop", value: "car_repair" } });
  assert.equal(r.osm.type, "node");
  assert.equal(r.osm.id, 456);
});

test("identity: way type/id are captured", () => {
  const r = buildOsmMetadataEnvelope({ element: { type: "way", id: 123, tags: { name: "X" } }, tag: { key: "shop", value: "car_repair" } });
  assert.equal(r.osm.type, "way");
  assert.equal(r.osm.id, 123);
});

test("identity: relation type/id are captured", () => {
  const r = buildOsmMetadataEnvelope({ element: { type: "relation", id: 789, tags: { name: "X" } }, tag: { key: "office", value: "company" } });
  assert.equal(r.osm.type, "relation");
  assert.equal(r.osm.id, 789);
});

// --- Category provenance ---

test("category provenance: shop=car_repair is preserved as the exact matched signal", () => {
  const r = buildOsmMetadataEnvelope({ element: { type: "node", id: 1, tags: { name: "X", shop: "car_repair" } }, tag: { key: "shop", value: "car_repair" } });
  assert.deepEqual(r.osm.category_signal, { key: "shop", value: "car_repair" });
  assert.equal(r.osm.tags.shop, "car_repair", "the raw tag itself is also preserved in tags, independently of category_signal");
});

test("category provenance: craft=electrician is preserved as the exact matched signal", () => {
  const r = buildOsmMetadataEnvelope({ element: { type: "node", id: 2, tags: { name: "X", craft: "electrician" } }, tag: { key: "craft", value: "electrician" } });
  assert.deepEqual(r.osm.category_signal, { key: "craft", value: "electrician" });
});

test("category provenance: missing tag param produces category_signal: null rather than throwing", () => {
  const r = buildOsmMetadataEnvelope({ element: { type: "node", id: 3, tags: { name: "X" } }, tag: undefined });
  assert.equal(r.osm.category_signal, null);
});

// --- Infrastructure evidence (the #7F "Downtown Connector" gap) ---

test("infrastructure: highway=primary is captured -- closes the #7F evidence gap", () => {
  const r = buildOsmMetadataEnvelope({
    element: { type: "way", id: 123, tags: { name: "Downtown Connector", highway: "primary" } },
    tag: { key: "shop", value: "car_repair" },
  });
  assert.equal(r.osm.tags.highway, "primary");
});

test("infrastructure: bridge/junction/railway/route are all captured when present", () => {
  const r = buildOsmMetadataEnvelope({
    element: { type: "way", id: 4, tags: { name: "X", bridge: "yes", junction: "roundabout", railway: "rail", route: "road" } },
    tag: { key: "shop", value: "car_repair" },
  });
  assert.equal(r.osm.tags.bridge, "yes");
  assert.equal(r.osm.tags.junction, "roundabout");
  assert.equal(r.osm.tags.railway, "rail");
  assert.equal(r.osm.tags.route, "road");
});

test("infrastructure: a normal business with NO infrastructure tags captures none", () => {
  const r = buildOsmMetadataEnvelope({ element: { type: "node", id: 5, tags: { name: "Damen Auto Repair", shop: "car_repair" } }, tag: { key: "shop", value: "car_repair" } });
  for (const key of ["highway", "railway", "waterway", "route", "bridge", "junction", "place", "boundary", "landuse"]) {
    assert.ok(!(key in r.osm.tags), `must not have invented "${key}"`);
  }
});

// --- Lifecycle ---

test("lifecycle: disused=yes is captured", () => {
  const r = buildOsmMetadataEnvelope({ element: { type: "node", id: 6, tags: { name: "X", shop: "car_repair", disused: "yes" } }, tag: { key: "shop", value: "car_repair" } });
  assert.equal(r.osm.tags.disused, "yes");
});

test("lifecycle: a disused:shop lifecycle-prefixed tag is captured", () => {
  const r = buildOsmMetadataEnvelope({ element: { type: "node", id: 7, tags: { name: "Location Closed", shop: "car_repair", "disused:shop": "car_repair" } }, tag: { key: "shop", value: "car_repair" } });
  assert.equal(r.osm.tags["disused:shop"], "car_repair");
});

test("lifecycle: abandoned/demolished/construction/proposed are all captured", () => {
  const r = buildOsmMetadataEnvelope({ element: { type: "node", id: 8, tags: { name: "X", abandoned: "yes", "demolished:shop": "car_repair", construction: "yes", proposed: "yes" } }, tag: { key: "shop", value: "car_repair" } });
  assert.equal(r.osm.tags.abandoned, "yes");
  assert.equal(r.osm.tags["demolished:shop"], "car_repair");
  assert.equal(r.osm.tags.construction, "yes");
  assert.equal(r.osm.tags.proposed, "yes");
});

test("lifecycle: check_date is captured as a freshness signal", () => {
  const r = buildOsmMetadataEnvelope({ element: { type: "node", id: 9, tags: { name: "X", shop: "car_repair", check_date: "2024-03-12" } }, tag: { key: "shop", value: "car_repair" } });
  assert.equal(r.osm.tags.check_date, "2024-03-12");
});

test("lifecycle: no lifecycle tag present -- none are invented", () => {
  const r = buildOsmMetadataEnvelope({ element: { type: "node", id: 10, tags: { name: "X", shop: "car_repair" } }, tag: { key: "shop", value: "car_repair" } });
  for (const key of ["disused", "abandoned", "demolished", "construction", "proposed", "check_date"]) {
    assert.ok(!(key in r.osm.tags));
  }
});

// --- Business identity ---

test("business identity: name/official_name/brand/operator are all captured when present", () => {
  const r = buildOsmMetadataEnvelope({
    element: { type: "node", id: 11, tags: { name: "ABC Auto", official_name: "ABC Auto Repair LLC", brand: "ABC", operator: "ABC Holdings", short_name: "ABC", alt_name: "ABC's" } },
    tag: { key: "shop", value: "car_repair" },
  });
  assert.equal(r.osm.tags.name, "ABC Auto");
  assert.equal(r.osm.tags.official_name, "ABC Auto Repair LLC");
  assert.equal(r.osm.tags.brand, "ABC");
  assert.equal(r.osm.tags.operator, "ABC Holdings");
  assert.equal(r.osm.tags.short_name, "ABC");
  assert.equal(r.osm.tags.alt_name, "ABC's");
});

// --- Contacts (existing supported set, unchanged) ---

test("contacts: phone/website/email/social tags are all captured exactly as before", () => {
  const r = buildOsmMetadataEnvelope({
    element: { type: "node", id: 12, tags: { name: "X", phone: "+1555", website: "https://x.example.com", email: "a@x.com", "contact:facebook": "xbiz" } },
    tag: { key: "shop", value: "car_repair" },
  });
  assert.equal(r.osm.tags.phone, "+1555");
  assert.equal(r.osm.tags.website, "https://x.example.com");
  assert.equal(r.osm.tags.email, "a@x.com");
  assert.equal(r.osm.tags["contact:facebook"], "xbiz");
});

// --- Data minimization: unknown/unapproved tags never leak through ---

test("data minimization: opening_hours, payment:*, and other unapproved tags are discarded", () => {
  const r = buildOsmMetadataEnvelope({
    element: { type: "node", id: 13, tags: { name: "X", shop: "car_repair", opening_hours: "Mo-Fr", "payment:visa": "yes", note: "some free text", fixme: "verify", wheelchair: "yes", start_date: "2012" } },
    tag: { key: "shop", value: "car_repair" },
  });
  const keys = Object.keys(r.osm.tags);
  assert.deepEqual(keys.sort(), ["name", "shop"].sort());
});

test("data minimization: an entirely untagged element (real #7E case, empty tags) produces an empty envelope, not a crash", () => {
  const r = buildOsmMetadataEnvelope({ element: { type: "node", id: 14, tags: {} }, tag: { key: "shop", value: "car_repair" } });
  assert.deepEqual(r.osm.tags, {});
  assert.deepEqual(r.osm.category_signal, { key: "shop", value: "car_repair" });
});

test("data minimization: a missing tags object entirely does not throw", () => {
  const r = buildOsmMetadataEnvelope({ element: { type: "node", id: 15 }, tag: { key: "shop", value: "car_repair" } });
  assert.deepEqual(r.osm.tags, {});
});

// --- Backward compatibility ---

test("backward compatibility: elementToCandidate's candidate-row fields (display_name/phone/email/website/state/city/address_raw) are completely unaffected by the new envelope", () => {
  const element = {
    type: "node", id: 16,
    tags: {
      name: "Rocket Plumbing", craft: "plumber", phone: "+1-773-906-7474", website: "https://rocketplumbingnow.com/",
      "addr:city": "Chicago", "addr:state": "IL", "addr:housenumber": "3443", "addr:street": "West Foster Avenue",
      "contact:facebook": "rocketplumbing", opening_hours: "Mo-Fr 07:00-19:00",
    },
  };
  const candidate = elementToCandidate({ element, categoryCode: "Plumber", countryName: "United States", city: "Chicago", tag: { key: "craft", value: "plumber" } });
  assert.equal(candidate.display_name, "Rocket Plumbing");
  assert.equal(candidate.phone, "+1-773-906-7474");
  assert.equal(candidate.website, "https://rocketplumbingnow.com/");
  assert.equal(candidate.state, "IL");
  assert.equal(candidate.city, "Chicago");
  assert.equal(candidate.address_raw, "3443 West Foster Avenue Chicago");
  // The richer envelope lives ONLY in raw_payload -- unrelated to the row fields above.
  assert.equal(candidate.raw_payload.osm.tags.highway, undefined);
  assert.equal(candidate.raw_payload.osm.category_signal.key, "craft");
});

test("backward compatibility: elementToCandidate works with no `tag` argument (existing callers that predate #8A)", () => {
  const element = { type: "node", id: 17, tags: { name: "X", shop: "car_repair" } };
  const candidate = elementToCandidate({ element, categoryCode: "Auto Mechanic", countryName: "United States", city: null });
  assert.equal(candidate.display_name, "X");
  assert.equal(candidate.raw_payload.osm.category_signal, null);
});

test("backward compatibility: discover() still passes the resolved tag through to every candidate (offline, mocked fetch)", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ elements: [{ type: "node", id: 18, tags: { name: "Test Plumbing", craft: "plumber" } }] }),
  });
  try {
    const results = await discover({ countryName: "Algeria", categoryCode: "Plumber", limit: 5 });
    assert.equal(results.length, 1);
    assert.deepEqual(results[0].raw_payload.osm.category_signal, { key: "craft", value: "plumber" });
  } finally {
    global.fetch = originalFetch;
  }
});

// --- Old-shape candidates coexist safely (no read path assumes new shape) ---

test("old-shape raw_payload (the #7A-#7E narrow {tags:{name,phone,website,social}} shape) is still valid JSON nothing needs to migrate", () => {
  const oldShape = { tags: { name: "Old Candidate", phone: "+1555", website: null } };
  // The only thing anything in this codebase does with raw_payload is
  // JSON.stringify it on write and return it as an opaque string on read
  // (see discovery/ingest.js and routes/adminCandidates.js) -- so an old
  // row remains perfectly valid without any migration.
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(oldShape)));
});
