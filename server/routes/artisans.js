const express = require("express");
const db = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const { rankingScore, conversionRatio } = require("../utils/ranking");

const router = express.Router();

// GET /api/artisans?category=&city=&minRating=&sort=
router.get("/", (req, res) => {
  const { category, city, minRating, q } = req.query;
  let rows = db
    .prepare(
      `SELECT u.id, u.name, p.trade, p.city, p.bio, p.avg_rating, p.review_count, p.jobs_completed, p.leads_received
       FROM artisan_profiles p JOIN users u ON u.id = p.user_id`
    )
    .all();

  if (category && category !== "All") rows = rows.filter((r) => r.trade === category);
  if (city && city !== "All") rows = rows.filter((r) => r.city === city);
  if (minRating) rows = rows.filter((r) => r.avg_rating >= parseFloat(minRating));
  if (q) {
    const needle = q.toLowerCase();
    rows = rows.filter(
      (r) =>
        r.name.toLowerCase().includes(needle) ||
        r.trade.toLowerCase().includes(needle) ||
        r.city.toLowerCase().includes(needle)
    );
  }

  rows = rows.map((r) => ({
    ...r,
    conversion_ratio: conversionRatio(r),
    ranking_score: rankingScore(r),
  }));

  rows.sort((a, b) => b.ranking_score - a.ranking_score);

  res.json(rows);
});

router.get("/:id", (req, res) => {
  const id = parseInt(req.params.id, 10);
  const profile = db
    .prepare(
      `SELECT u.id, u.name, p.trade, p.city, p.bio, p.avg_rating, p.review_count, p.jobs_completed, p.leads_received
       FROM artisan_profiles p JOIN users u ON u.id = p.user_id WHERE u.id = ?`
    )
    .get(id);
  if (!profile) return res.status(404).json({ error: "Profile not found." });

  const portfolio = db
    .prepare("SELECT id, label, note FROM portfolio_items WHERE artisan_id = ? ORDER BY id DESC")
    .all(id);
  const reviews = db
    .prepare(
      `SELECT r.id, r.rating, r.comment, r.created_at, u.name AS author
       FROM reviews r JOIN users u ON u.id = r.client_id
       WHERE r.artisan_id = ? ORDER BY r.created_at DESC LIMIT 20`
    )
    .all(id);

  res.json({
    ...profile,
    conversion_ratio: conversionRatio(profile),
    ranking_score: rankingScore(profile),
    portfolio,
    reviews,
  });
});

router.put("/me", requireAuth, requireRole("artisan"), (req, res) => {
  const { bio, city, trade } = req.body || {};
  db.prepare(
    "UPDATE artisan_profiles SET bio = COALESCE(?, bio), city = COALESCE(?, city), trade = COALESCE(?, trade) WHERE user_id = ?"
  ).run(bio, city, trade, req.user.id);
  res.json({ ok: true });
});

router.post("/me/portfolio", requireAuth, requireRole("artisan"), (req, res) => {
  const { label, note } = req.body || {};
  if (!label) return res.status(400).json({ error: "Give this piece of work a title." });
  const info = db
    .prepare("INSERT INTO portfolio_items (artisan_id, label, note) VALUES (?,?,?)")
    .run(req.user.id, label, note || "");
  res.status(201).json({ id: info.lastInsertRowid, label, note: note || "" });
});

module.exports = router;
