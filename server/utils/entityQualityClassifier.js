// README roadmap #7D: measurement-only entity-quality classifier.
//
// Purpose: distinguish a hireable individual/small-business tradesperson
// from an institutional entity that happens to carry the same OSM
// craft=/shop= tag (a union hall, a trade school, a licensing board) --
// and separately, an obvious category mismatch (tagged as one trade,
// named like a different, unrelated one). Grounded in real #7C candidates:
// "Plumbers Local 68" (union), "Plumbers Local Union No. 68 Group
// Protection Plan and Benefit Office" (benefits office), "Electrical
// Training Center" / Houston JATC (trade school), "AFAB Upholstery"
// tagged shop=car_repair (category mismatch).
//
// This is explicitly NOT a semantic/AI classifier and NEVER touches
// production data: it is a pure function over already-stored candidate
// fields (display_name, category_code), called only from #7D's
// measurement/analysis code. It does not run inside the ingestion
// pipeline, does not write to the database, and produces no side effect
// of any kind.
//
// Conservative by design: only a small set of high-confidence,
// unambiguous keyword/pattern signals count as "likely_institutional" or
// a category mismatch. Anything that doesn't match one of those signals
// is either "likely_hireable" (a plausible normal business name) or
// "uncertain" (no display name to assess at all) -- "uncertain" is a
// first-class outcome, never coerced into either extreme, and #7D's
// corrected-metric calculation must never exclude it.

const INSTITUTIONAL_PATTERNS = [
  { pattern: /\bunion\b/i, reason: "contains 'union'" },
  { pattern: /\blocal\s+\d+\b/i, reason: "matches a union-local naming pattern ('Local <number>')" },
  { pattern: /\bbenefit(s)?\s+(office|fund|plan)\b/i, reason: "contains a benefits-office/fund/plan phrase" },
  { pattern: /\btraining\s+center\b/i, reason: "contains 'training center'" },
  { pattern: /\btrade\s+school\b/i, reason: "contains 'trade school'" },
  { pattern: /\bvocational\b/i, reason: "contains 'vocational'" },
  { pattern: /\bapprenticeship\b/i, reason: "contains 'apprenticeship'" },
  { pattern: /\bjatc\b/i, reason: "contains 'JATC' (Joint Apprenticeship Training Committee)" },
  { pattern: /\bchamber\s+of\s+commerce\b/i, reason: "contains 'chamber of commerce'" },
  { pattern: /\bassociation\b/i, reason: "contains 'association'" },
  { pattern: /\b(department|city|county|state)\s+of\b/i, reason: "matches a government-entity naming pattern" },
  { pattern: /\blicensing\s+board\b/i, reason: "contains 'licensing board'" },
  { pattern: /\bregulatory\b/i, reason: "contains 'regulatory'" },
  { pattern: /\bnon[- ]?profit\b/i, reason: "contains 'nonprofit'" },
];

// Per-category, high-confidence off-topic keywords -- only added where a
// real #7C candidate demonstrated the pattern (Auto Mechanic/upholstery).
// Deliberately sparse: an unproven guess here would violate the "only
// high-confidence, obvious" requirement.
const CATEGORY_MISMATCH_PATTERNS = {
  "Auto Mechanic": [
    { pattern: /\bupholstery\b/i, reason: "upholstery shop, not general auto repair" },
    { pattern: /\bwindow\s+tint(ing)?\b/i, reason: "window tinting shop, not general auto repair" },
    { pattern: /\bcar\s+wash\b/i, reason: "car wash, not a repair business" },
  ],
  "Plumber": [],
  "Electrician": [],
};

/**
 * classifyEntityQuality({ displayName, categoryCode }):
 *   -> { classification: "likely_hireable" | "likely_institutional" | "uncertain",
 *        categoryMismatch: boolean,
 *        categoryMismatchReason: string | null,
 *        reason: string | null }
 *
 * `categoryMismatch` is a fully INDEPENDENT axis from `classification` --
 * a category-mismatched business (e.g. an upholstery shop tagged
 * shop=car_repair) is not institutional, it is simply the wrong trade for
 * the category it was discovered under. It stays classification=
 * "likely_hireable" (it likely IS a real, hireable business -- just not
 * for this category) with categoryMismatch=true reported alongside. Both
 * flags are independent exclusion reasons for #7D's corrected-metric
 * calculation, tracked and reported separately per the spec's table
 * structure -- never collapsed into one bucket.
 */
function classifyEntityQuality({ displayName, categoryCode }) {
  if (!displayName || !displayName.trim()) {
    return { classification: "uncertain", categoryMismatch: false, categoryMismatchReason: null, reason: "no display name to assess" };
  }

  const name = displayName.trim();

  let categoryMismatch = false;
  let categoryMismatchReason = null;
  const mismatchPatterns = CATEGORY_MISMATCH_PATTERNS[categoryCode] || [];
  for (const { pattern, reason } of mismatchPatterns) {
    if (pattern.test(name)) {
      categoryMismatch = true;
      categoryMismatchReason = reason;
      break;
    }
  }

  for (const { pattern, reason } of INSTITUTIONAL_PATTERNS) {
    if (pattern.test(name)) {
      return { classification: "likely_institutional", categoryMismatch, categoryMismatchReason, reason };
    }
  }

  return { classification: "likely_hireable", categoryMismatch, categoryMismatchReason, reason: null };
}

/**
 * isExcludedFromCorrectedMetric(qualityResult): the single, explicit rule
 * for #7D's corrected acquisition-ready calculation -- excludes ONLY
 * high-confidence institutional entities and category mismatches.
 * "uncertain" (no display name) is NEVER excluded by this function,
 * exactly per the #7D requirement that uncertain candidates must remain
 * in the corrected metric.
 */
function isExcludedFromCorrectedMetric(qualityResult) {
  return qualityResult.classification === "likely_institutional" || qualityResult.categoryMismatch === true;
}

module.exports = {
  classifyEntityQuality,
  isExcludedFromCorrectedMetric,
  INSTITUTIONAL_PATTERNS,
  CATEGORY_MISMATCH_PATTERNS,
};
