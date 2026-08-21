const express = require("express");
const db = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const { rankingScore, conversionRatio } = require("../utils/ranking");
const { isOnline } = require("../presence");

const router = express.Router();

// GET /api/artisans?category=&city=&minRating=&sort=&limit=&offset=
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

  const total = rows.length;
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
  const results = rows.slice(offset, offset + limit);

  res.json({ results, total, limit, offset });
});

router.get("/:id", (req, res) => {
  const id = parseInt(req.params.id, 10);
  const profile = db
    .prepare(
      `SELECT u.id, u.name, p.trade, p.city, p.bio, p.avg_rating, p.review_count, p.jobs_completed, p.leads_received,
        p.service_radius_km, u.last_seen_at
       FROM artisan_profiles p JOIN users u ON u.id = p.user_id WHERE u.id = ?`
    )
    .get(id);
  if (!profile) return res.status(404).json({ error: "Profile not found." });
  profile.online = isOnline(id);

  const portfolio = db
    .prepare("SELECT id, label, note FROM portfolio_items WHERE artisan_id = ? AND hidden = 0 ORDER BY id DESC")
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
  const { bio, city, trade, latitude, longitude, service_radius_km } = req.body || {};
  db.prepare(
    `UPDATE artisan_profiles SET
      bio = COALESCE(?, bio),
      city = COALESCE(?, city),
      trade = COALESCE(?, trade),
      latitude = COALESCE(?, latitude),
      longitude = COALESCE(?, longitude),
      service_radius_km = COALESCE(?, service_radius_km)
     WHERE user_id = ?`
  ).run(bio, city, trade, latitude, longitude, service_radius_km, req.user.id);
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

// Full portfolio for the owning artisan, including hidden items -- the
// public GET /:id profile above excludes hidden ones, so the dashboard
// needs its own view to let the artisan manage (and un-hide) everything.
router.get("/me/portfolio", requireAuth, requireRole("artisan"), (req, res) => {
  const items = db
    .prepare("SELECT id, label, note, hidden, lead_id FROM portfolio_items WHERE artisan_id = ? ORDER BY id DESC")
    .all(req.user.id);
  res.json(items);
});

router.put("/me/portfolio/:id", requireAuth, requireRole("artisan"), (req, res) => {
  const item = db
    .prepare("SELECT * FROM portfolio_items WHERE id = ? AND artisan_id = ?")
    .get(req.params.id, req.user.id);
  if (!item) return res.status(404).json({ error: "Portfolio item not found." });

  const { label, note } = req.body || {};
  if (label !== undefined && !label.trim()) {
    return res.status(400).json({ error: "Give this piece of work a title." });
  }
  db.prepare("UPDATE portfolio_items SET label = COALESCE(?, label), note = COALESCE(?, note) WHERE id = ?").run(
    label,
    note,
    item.id
  );
  res.json({ ok: true });
});

// Toggle hidden. Freeform items (no lead_id) are purely cosmetic. Items
// linked to a confirmed job (lead_id set) move jobs_completed and, since
// ranking_score is derived rather than stored, the recomputed score comes
// back in the response so the UI can reflect the impact immediately.
router.put("/me/portfolio/:id/hide", requireAuth, requireRole("artisan"), (req, res) => {
  const item = db
    .prepare("SELECT * FROM portfolio_items WHERE id = ? AND artisan_id = ?")
    .get(req.params.id, req.user.id);
  if (!item) return res.status(404).json({ error: "Portfolio item not found." });

  const nextHidden = item.hidden ? 0 : 1;
  db.prepare("UPDATE portfolio_items SET hidden = ? WHERE id = ?").run(nextHidden, item.id);

  let profile = db.prepare("SELECT * FROM artisan_profiles WHERE user_id = ?").get(req.user.id);
  if (item.lead_id) {
    const delta = nextHidden ? -1 : 1;
    const nextJobs = Math.max(0, profile.jobs_completed + delta);
    db.prepare("UPDATE artisan_profiles SET jobs_completed = ? WHERE user_id = ?").run(nextJobs, req.user.id);
    profile = db.prepare("SELECT * FROM artisan_profiles WHERE user_id = ?").get(req.user.id);
  }

  res.json({
    ok: true,
    hidden: !!nextHidden,
    jobs_completed: profile.jobs_completed,
    ranking_score: rankingScore(profile),
  });
});

module.exports = router;
