const express = require("express");
const db = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

// Only a client who went through the hire -> complete flow can review,
// and only once per lead.
const MAX_COMMENT_LENGTH = 1000;

// README roadmap #6: an INSERT can still race a concurrent duplicate past
// the `already` check below (two near-simultaneous requests both reading
// "no review yet" before either commits) -- idx_reviews_lead_unique is the
// actual backstop for that, added specifically to make this race
// impossible rather than just unlikely. This distinguishes that specific
// failure (both drivers, by their own violation codes) from any other
// unexpected DB error, which should still surface normally.
function isUniqueViolation(err) {
  return err.code === "23505" || err.code === "SQLITE_CONSTRAINT_UNIQUE" || /UNIQUE constraint failed/i.test(err.message || "");
}

// Only a client who went through the hire -> complete flow can review,
// and only once per lead.
router.post("/", requireAuth, requireRole("client"), async (req, res) => {
  const { leadId, rating, comment } = req.body || {};
  const lead = await db.prepare("SELECT * FROM leads WHERE id = ?").get(leadId);
  if (!lead || lead.client_id !== req.user.id) {
    return res.status(404).json({ error: "Lead not found." });
  }
  if (lead.status !== "completed") {
    return res.status(400).json({ error: "You can review once the job is marked complete." });
  }
  const already = await db.prepare("SELECT id FROM reviews WHERE lead_id = ?").get(leadId);
  if (already) return res.status(409).json({ error: "You already reviewed this job." });
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ error: "Rating must be 1 to 5." });
  }
  if (comment !== undefined && comment !== null && String(comment).length > MAX_COMMENT_LENGTH) {
    return res.status(400).json({ error: `Review comment must be ${MAX_COMMENT_LENGTH} characters or fewer.` });
  }

  let info;
  try {
    info = await db
      .prepare("INSERT INTO reviews (lead_id, client_id, artisan_id, rating, comment) VALUES (?,?,?,?,?)")
      .run(leadId, req.user.id, lead.artisan_id, rating, comment || "");
  } catch (err) {
    if (isUniqueViolation(err)) return res.status(409).json({ error: "You already reviewed this job." });
    throw err;
  }

  const agg = await db
    .prepare("SELECT AVG(rating) AS avg, COUNT(*) AS n FROM reviews WHERE artisan_id = ?")
    .get(lead.artisan_id);
  // Postgres returns AVG()/COUNT() as NUMERIC/BIGINT, which the pg driver
  // hands back as strings (to avoid JS float/precision loss) -- SQLite
  // already returns plain numbers here, so Number(...) normalizes both to
  // the same result shape the rest of this app expects.
  await db.prepare(
    "UPDATE artisan_profiles SET avg_rating = ?, review_count = ? WHERE user_id = ?"
  ).run(Math.round(Number(agg.avg) * 10) / 10, Number(agg.n), lead.artisan_id);

  res.status(201).json({ ok: true, id: info.lastInsertRowid });
});

module.exports = router;
