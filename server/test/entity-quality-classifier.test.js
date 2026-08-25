// README roadmap #7D: tests for the measurement-only entity-quality
// classifier (server/utils/entityQualityClassifier.js). Pure-function
// tests, no DB, no network -- same convention as normalize.test.js-style
// utilities throughout this codebase. Every institutional case below is a
// REAL candidate name discovered during #7C, not a hypothetical.
const test = require("node:test");
const assert = require("node:assert/strict");
const { classifyEntityQuality, isExcludedFromCorrectedMetric } = require("../utils/entityQualityClassifier");

// --- Real #7C institutional entities ---

test("union hall: 'Plumbers Local 68' -> likely_institutional", () => {
  const result = classifyEntityQuality({ displayName: "Plumbers Local 68", categoryCode: "Plumber" });
  assert.equal(result.classification, "likely_institutional");
  assert.equal(result.categoryMismatch, false);
  assert.ok(result.reason);
});

test("benefits office: 'Plumbers Local Union No. 68 Group Protection Plan and Benefit Office' -> likely_institutional", () => {
  const result = classifyEntityQuality({
    displayName: "Plumbers Local Union No. 68 Group Protection Plan and Benefit Office",
    categoryCode: "Plumber",
  });
  assert.equal(result.classification, "likely_institutional");
});

test("trade school: 'Electrical Training Center' -> likely_institutional", () => {
  const result = classifyEntityQuality({ displayName: "Electrical Training Center", categoryCode: "Electrician" });
  assert.equal(result.classification, "likely_institutional");
  assert.match(result.reason, /training center/i);
});

test("training center (JATC acronym): 'Houston JATC' -> likely_institutional", () => {
  const result = classifyEntityQuality({ displayName: "Houston JATC", categoryCode: "Electrician" });
  assert.equal(result.classification, "likely_institutional");
});

test("vocational school phrasing -> likely_institutional", () => {
  const result = classifyEntityQuality({ displayName: "Midwest Plumbing Vocational Institute", categoryCode: "Plumber" });
  assert.equal(result.classification, "likely_institutional");
});

test("apprenticeship program -> likely_institutional", () => {
  const result = classifyEntityQuality({ displayName: "IBEW Electrician Apprenticeship Program", categoryCode: "Electrician" });
  assert.equal(result.classification, "likely_institutional");
});

test("government entity: 'City of Chicago Plumbing Inspections' -> likely_institutional", () => {
  const result = classifyEntityQuality({ displayName: "City of Chicago Plumbing Inspections", categoryCode: "Plumber" });
  assert.equal(result.classification, "likely_institutional");
});

test("trade association -> likely_institutional", () => {
  const result = classifyEntityQuality({ displayName: "National Auto Mechanics Association", categoryCode: "Auto Mechanic" });
  assert.equal(result.classification, "likely_institutional");
});

// --- Normal, real hireable businesses (must NOT be flagged) ---

test("normal plumbing business: 'Rodding Rooter' -> likely_hireable", () => {
  const result = classifyEntityQuality({ displayName: "Rodding Rooter", categoryCode: "Plumber" });
  assert.equal(result.classification, "likely_hireable");
  assert.equal(result.categoryMismatch, false);
});

test("normal electrical business: 'Lumens Electric LLC' -> likely_hireable", () => {
  const result = classifyEntityQuality({ displayName: "Lumens Electric LLC", categoryCode: "Electrician" });
  assert.equal(result.classification, "likely_hireable");
});

test("normal auto mechanic: 'Damen Auto Repair' -> likely_hireable", () => {
  const result = classifyEntityQuality({ displayName: "Damen Auto Repair", categoryCode: "Auto Mechanic" });
  assert.equal(result.classification, "likely_hireable");
});

// A name containing "Local" as an ordinary marketing word, with NO
// following number, must not false-positive on the union-local pattern.
test("'local' used as a plain adjective (no number) is NOT flagged -- avoids a false positive", () => {
  const result = classifyEntityQuality({ displayName: "Local Plumbing Experts", categoryCode: "Plumber" });
  assert.equal(result.classification, "likely_hireable");
});

// --- Uncertain cases ---

test("no display name -> uncertain, not hireable and not institutional", () => {
  const result = classifyEntityQuality({ displayName: null, categoryCode: "Plumber" });
  assert.equal(result.classification, "uncertain");
  assert.equal(result.categoryMismatch, false);
});

test("empty/whitespace-only display name -> uncertain", () => {
  const result = classifyEntityQuality({ displayName: "   ", categoryCode: "Electrician" });
  assert.equal(result.classification, "uncertain");
});

// --- Obvious category mismatch (real #7C case) ---

test("category mismatch: 'AFAB Upholstery' tagged Auto Mechanic -> categoryMismatch=true, but still likely_hireable (a real business, wrong trade)", () => {
  const result = classifyEntityQuality({ displayName: "AFAB Upholstery", categoryCode: "Auto Mechanic" });
  assert.equal(result.categoryMismatch, true);
  assert.equal(result.classification, "likely_hireable", "a category-mismatched business is not institutional -- it's simply the wrong trade");
});

test("category mismatch: window tinting under Auto Mechanic", () => {
  const result = classifyEntityQuality({ displayName: "Elite Window Tinting", categoryCode: "Auto Mechanic" });
  assert.equal(result.categoryMismatch, true);
});

test("category mismatch: car wash under Auto Mechanic", () => {
  const result = classifyEntityQuality({ displayName: "Sparkle Car Wash", categoryCode: "Auto Mechanic" });
  assert.equal(result.categoryMismatch, true);
});

test("no category-mismatch keywords defined for Plumber/Electrician -- a plausible name never false-positives", () => {
  assert.equal(classifyEntityQuality({ displayName: "Quick Fix Plumbing", categoryCode: "Plumber" }).categoryMismatch, false);
  assert.equal(classifyEntityQuality({ displayName: "Bright Spark Electric", categoryCode: "Electrician" }).categoryMismatch, false);
});

// A name that is BOTH institutional AND category-mismatched -- both flags
// must surface independently, never collapsed into one.
test("an entity can be both institutional and category-mismatched -- both flags surface independently", () => {
  const result = classifyEntityQuality({ displayName: "Upholstery Trade School", categoryCode: "Auto Mechanic" });
  assert.equal(result.classification, "likely_institutional", "'trade school' makes this institutional");
  assert.equal(result.categoryMismatch, true, "'upholstery' is also a category mismatch for Auto Mechanic, independently of the institutional flag");
});

// --- isExcludedFromCorrectedMetric: the explicit corrected-metric rule ---

test("isExcludedFromCorrectedMetric: likely_institutional is excluded", () => {
  assert.equal(isExcludedFromCorrectedMetric({ classification: "likely_institutional", categoryMismatch: false }), true);
});

test("isExcludedFromCorrectedMetric: category mismatch alone is excluded, even if classification is likely_hireable", () => {
  assert.equal(isExcludedFromCorrectedMetric({ classification: "likely_hireable", categoryMismatch: true }), true);
});

test("isExcludedFromCorrectedMetric: likely_hireable with no mismatch is NOT excluded", () => {
  assert.equal(isExcludedFromCorrectedMetric({ classification: "likely_hireable", categoryMismatch: false }), false);
});

test("isExcludedFromCorrectedMetric: uncertain is NEVER excluded -- the explicit #7D requirement", () => {
  assert.equal(isExcludedFromCorrectedMetric({ classification: "uncertain", categoryMismatch: false }), false);
});
