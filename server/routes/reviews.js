const express = require("express");
const db = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

// Only a client who went through the hire -> complete flow can review,
// and only once per lead.
router.post("/", requireAuth, requireRole("client"), (req, res) => {
  const { leadId, rating, comment } = req.body || {};
  const lead = db.prepare("SELECT * FROM leads WHERE id = ?").get(leadId);
  if (!lead || lead.client_id !== req.user.id) {
    return res.status(404).json({ error: "Lead not found." });
  }
  if (lead.status !== "completed") {
    return res.status(400).json({ error: "You can review once the job is marked complete." });
  }
  const already = db.prepare("SELECT id FROM reviews WHERE lead_id = ?").get(leadId);
  if (already) return res.status(409).json({ error: "You already reviewed this job." });
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ error: "Rating must be 1 to 5." });
  }

  db.prepare(
    "INSERT INTO reviews (lead_id, client_id, artisan_id, rating, comment) VALUES (?,?,?,?,?)"
  ).run(leadId, req.user.id, lead.artisan_id, rating, comment || "");

  const agg = db
    .prepare("SELECT AVG(rating) AS avg, COUNT(*) AS n FROM reviews WHERE artisan_id = ?")
    .get(lead.artisan_id);
  db.prepare(
    "UPDATE artisan_profiles SET avg_rating = ?, review_count = ? WHERE user_id = ?"
  ).run(Math.round(agg.avg * 10) / 10, agg.n, lead.artisan_id);

  res.status(201).json({ ok: true });
});

module.exports = router;
