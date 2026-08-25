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

// ─── README roadmap #7E: franchise/chain + defunct/closed detection ─────────
//
// Extends the #7D classifier ADDITIVELY -- classifyEntityQuality() and
// isExcludedFromCorrectedMetric() above are completely unchanged (byte-
// identical), preserving #7D's institutional/category-mismatch behavior
// exactly. This is a retrospective re-analysis of the existing 62 stored
// candidates only: every detector below reads only fields already present
// on a stored candidate row (display_name, website, website_domain) --
// never a new OSM/Overpass lookup, never a live web check, per #7E's
// explicit "no new discovery, no live verification" mandate. Where the
// stored data doesn't establish something with high confidence, the
// answer is "uncertain," never a guess.

// Curated, high-confidence national/regional chain and franchise brand
// names for the trades #7A-#7D actually discover (Plumber, Electrician,
// Auto Mechanic). Every Auto Mechanic entry below was verified against a
// REAL #7C/#7D candidate's stored name and (where present) website domain
// before being added -- see the #7E report for the verification detail
// (e.g. id 73 "Pep Boys" / website pepboys.com; id 84 "Safelite AutoGlass"
// / website safelite.com; id 61 "Goettl Air Conditioning & Plumbing" /
// website goettl.com). The Plumber/Electrician entries are real, publicly
// documented national franchise brands in those trades, included so the
// detector isn't accidentally scoped to "whatever happened to already
// match" -- none of them happened to appear in the 62-candidate dataset,
// which is itself a reportable (negative) finding, not evidence to hide.
// Deliberately NOT a name-similarity/fuzzy heuristic: every entry is an
// exact or near-exact known brand string, matched conservatively. Scoped
// per category (mirroring CATEGORY_MISMATCH_PATTERNS' existing structure)
// so an auto-service brand can never match a Plumber/Electrician
// candidate, or vice versa -- one more layer against a coincidental
// cross-trade substring match.
const FRANCHISE_BRANDS = {
  "Auto Mechanic": [
    // Verified present in the #7C/#7D dataset
    "Pep Boys", "Grease Monkey", "Midas", "Kwik Kar", "Havoline Express Lube", "Havoline Xpress Lube",
    "Safelite AutoGlass", "Safelite", "Mobil 1 Lube Express",
    // Well-documented national chains, not present in this dataset
    "Jiffy Lube", "Valvoline Instant Oil Change", "Take 5 Oil Change", "Meineke", "AAMCO", "Maaco",
    "Firestone Complete Auto Care", "Christian Brothers Automotive", "Big O Tires", "Discount Tire",
    "NTB", "National Tire & Battery", "Mavis Tire", "Monro Muffler", "Tuffy Auto Service",
  ],
  "Plumber": [
    // Verified present in the #7C/#7D dataset (Goettl also does HVAC, but the
    // #7C candidate itself was tagged/discovered under Plumber)
    "Goettl",
    // Well-documented national franchises, not present in this dataset
    "Roto-Rooter", "Mr. Rooter", "Benjamin Franklin Plumbing",
  ],
  "Electrician": [
    // Well-documented national franchises, not present in this dataset
    "Mister Sparky", "One Hour Air Conditioning",
  ],
};

/**
 * detectFranchiseChain({ displayName, categoryCode, website, websiteDomain }):
 *   -> { isFranchise: boolean, confidence: "high" | null, reason: string | null, evidence: string | null }
 *
 * High confidence only: an exact or near-exact match of the candidate's
 * display_name against FRANCHISE_BRANDS for its OWN category, optionally
 * corroborated by the candidate's own stored website domain matching the
 * brand's real domain (evidence is upgraded, never invented, when that
 * corroboration exists). Never infers a franchise from a merely
 * "corporate-sounding" name, a polished website, multiple social tags, or
 * any other indirect signal -- #7E explicitly forbids those as sole
 * evidence. No match -> isFranchise: false (folded into "likely_hireable"
 * by the caller, not "uncertain" -- the ABSENCE of a known-brand match is
 * not itself uncertainty about the candidate's identity, which is a
 * separate question classifyEntityQuality already answers).
 */
function detectFranchiseChain({ displayName, categoryCode, website, websiteDomain }) {
  if (!displayName || !displayName.trim()) {
    return { isFranchise: false, confidence: null, reason: null, evidence: null };
  }
  const name = displayName.trim().toLowerCase();
  const brands = FRANCHISE_BRANDS[categoryCode] || [];
  for (const brand of brands) {
    const brandLower = brand.toLowerCase();
    if (name === brandLower || name.includes(brandLower)) {
      const domainNote = websiteDomain ? ` (stored website domain: ${websiteDomain})` : "";
      return {
        isFranchise: true,
        confidence: "high",
        reason: `stored candidate name matches recognized national/regional chain brand "${brand}"`,
        evidence: `display_name="${displayName}"${domainNote}`,
      };
    }
  }
  return { isFranchise: false, confidence: null, reason: null, evidence: null };
}

// High-confidence, explicit closure language only -- grounded in the one
// real #7D example (id 76, display_name literally "Location Closed").
// Missing fields (no website/phone/email) are deliberately NOT signals
// here at all -- #7E is explicit that absence of data is not evidence of
// closure.
const DEFUNCT_PATTERNS = [
  { pattern: /\bpermanently\s+closed\b/i, reason: "contains 'permanently closed'" },
  { pattern: /\blocation\s+closed\b/i, reason: "contains 'location closed'" },
  { pattern: /\bclosed\s+down\b/i, reason: "contains 'closed down'" },
  { pattern: /\bdefunct\b/i, reason: "contains 'defunct'" },
  { pattern: /\bdisused\b/i, reason: "contains 'disused'" },
  { pattern: /\babandoned\b/i, reason: "contains 'abandoned'" },
  { pattern: /\bout\s+of\s+business\b/i, reason: "contains 'out of business'" },
  { pattern: /\bno\s+longer\s+(open|operating|in\s+business)\b/i, reason: "contains 'no longer open/operating/in business'" },
  // A bare, standalone "closed" as essentially the entire name (not a
  // substring like "Closed Loop Plumbing") -- matches the real #7D case
  // ("Location Closed") without flagging a legitimately-named business
  // that merely contains the word.
  { pattern: /^closed$/i, reason: "display name is literally 'Closed'" },
];

/**
 * detectDefunctClosed({ displayName }):
 *   -> { isDefunct: boolean, confidence: "high" | null, reason: string | null, evidence: string | null }
 *
 * Reads only display_name, since that's the only closure-relevant signal
 * actually present in stored #7C/#7D candidate data -- raw_payload never
 * captured OSM's disused:/was: lifecycle-prefix tags (a real, reportable
 * limitation: any node ORIGINALLY tagged with a lifecycle prefix like
 * disused:shop=car_repair would never have matched the original
 * shop="car_repair" Overpass filter in the first place, so it couldn't be
 * in this dataset at all -- the only closure evidence that COULD reach us
 * is a business literally named to say so, as #7D's "Location Closed"
 * case shows).
 */
function detectDefunctClosed({ displayName }) {
  if (!displayName || !displayName.trim()) {
    return { isDefunct: false, confidence: null, reason: null, evidence: null };
  }
  const name = displayName.trim();
  for (const { pattern, reason } of DEFUNCT_PATTERNS) {
    if (pattern.test(name)) {
      return { isDefunct: true, confidence: "high", reason, evidence: `display_name="${displayName}"` };
    }
  }
  return { isDefunct: false, confidence: null, reason: null, evidence: null };
}

/**
 * classifyExpandedEntityQuality(candidate): combines classifyEntityQuality
 * (unchanged #7D logic) with the two new #7E detectors into one result:
 *   {
 *     classification: "likely_hireable" | "likely_institutional" | "franchise_chain" | "defunct_closed" | "uncertain",
 *     reasons: [{ type, confidence, evidence }, ...],  // every matched high-confidence reason, never just the first
 *     categoryMismatch: boolean,
 *     excluded: boolean,  // true iff reasons.length > 0 (institutional/franchise/defunct/mismatch) -- "uncertain" alone never sets this
 *   }
 * `classification` is a single summary label for readability (first match
 * wins, in the order institutional -> franchise -> defunct -> hireable/
 * uncertain) -- `reasons` is the authoritative, complete record for
 * anything that needs to know EVERY contamination signal that fired, per
 * #7E's explicit "track all detected reasons, exclude only once" rule.
 */
function classifyExpandedEntityQuality(candidate) {
  const { displayName, categoryCode, website, websiteDomain } = candidate;
  const base = classifyEntityQuality({ displayName, categoryCode });
  const franchise = detectFranchiseChain({ displayName, categoryCode, website, websiteDomain });
  const defunct = detectDefunctClosed({ displayName });

  const reasons = [];
  if (base.classification === "likely_institutional") {
    reasons.push({ type: "institutional", confidence: "high", evidence: base.reason });
  }
  if (franchise.isFranchise) {
    reasons.push({ type: "franchise_chain", confidence: franchise.confidence, evidence: franchise.reason });
  }
  if (defunct.isDefunct) {
    reasons.push({ type: "defunct_closed", confidence: defunct.confidence, evidence: defunct.reason });
  }
  if (base.categoryMismatch) {
    reasons.push({ type: "category_mismatch", confidence: "high", evidence: base.categoryMismatchReason });
  }

  let classification;
  if (base.classification === "uncertain") classification = "uncertain";
  else if (base.classification === "likely_institutional") classification = "likely_institutional";
  else if (franchise.isFranchise) classification = "franchise_chain";
  else if (defunct.isDefunct) classification = "defunct_closed";
  else classification = "likely_hireable";

  return {
    classification,
    reasons,
    categoryMismatch: base.categoryMismatch,
    excluded: reasons.length > 0,
  };
}

/**
 * isExcludedFromExpandedMetric(expandedResult): the #7E corrected-
 * ("expanded corrected") metric rule -- excludes a candidate exactly once
 * if ANY high-confidence reason (institutional, franchise_chain,
 * defunct_closed, category_mismatch) fired, regardless of how many did.
 * "uncertain" is never excluded, matching #7D's rule exactly.
 */
function isExcludedFromExpandedMetric(expandedResult) {
  return expandedResult.excluded === true;
}

module.exports = {
  classifyEntityQuality,
  isExcludedFromCorrectedMetric,
  detectFranchiseChain,
  detectDefunctClosed,
  classifyExpandedEntityQuality,
  isExcludedFromExpandedMetric,
  INSTITUTIONAL_PATTERNS,
  CATEGORY_MISMATCH_PATTERNS,
  FRANCHISE_BRANDS,
  DEFUNCT_PATTERNS,
};
