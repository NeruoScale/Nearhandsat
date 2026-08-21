const express = require("express");
const db = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const { MIN_LEADS_FOR_CONVERSION } = require("../utils/ranking");

const router = express.Router();
router.use(requireAuth, requireRole("admin"));

router.get("/stats", (req, res) => {
  const totals = db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM users WHERE role='client') AS clients,
        (SELECT COUNT(*) FROM users WHERE role='artisan') AS artisans,
        (SELECT COUNT(*) FROM leads) AS leads,
        (SELECT COUNT(*) FROM leads WHERE status IN ('hired','completed')) AS hires,
        (SELECT COUNT(*) FROM reviews) AS reviews`
    )
    .get();
  totals.conversion_rate = totals.leads
    ? Math.round((totals.hires / totals.leads) * 1000) / 10
    : 0;

  const byCategory = db
    .prepare(
      `SELECT p.trade AS category, p.city,
        COUNT(l.id) AS leads,
        SUM(CASE WHEN l.status IN ('hired','completed') THEN 1 ELSE 0 END) AS hires
       FROM artisan_profiles p
       LEFT JOIN leads l ON l.artisan_id = p.user_id
       GROUP BY p.trade, p.city
       ORDER BY p.city, p.trade`
    )
    .all()
    .map((r) => ({
      ...r,
      conversion_rate: r.leads ? Math.round((r.hires / r.leads) * 1000) / 10 : 0,
    }));

  res.json({ totals, byCategory });
});

// Soft-fraud detection: artisans with a lot of leads but a suspiciously
// low confirmed-hire ratio. Informational only -- used to lower search
// ranking or prompt manual review, never an automatic ban.
router.get("/flagged", (req, res) => {
  const rows = db
    .prepare(
      `SELECT u.id, u.name, p.trade, p.city, p.leads_received, p.jobs_completed
       FROM artisan_profiles p JOIN users u ON u.id = p.user_id
       WHERE p.leads_received >= ?`
    )
    .all(MIN_LEADS_FOR_CONVERSION)
    .map((r) => ({ ...r, ratio: Math.round((r.jobs_completed / r.leads_received) * 1000) / 10 }))
    .filter((r) => r.ratio < 20)
    .sort((a, b) => a.ratio - b.ratio);

  res.json(rows);
});

router.get("/billing", (req, res) => {
  res.json(db.prepare("SELECT * FROM billing_settings ORDER BY city, category").all());
});

router.put("/billing/:id", (req, res) => {
  const { paid_mode, free_lead_limit, price_per_lead, subscription_price } = req.body || {};
  db.prepare(
    `UPDATE billing_settings SET
      paid_mode = COALESCE(?, paid_mode),
      free_lead_limit = COALESCE(?, free_lead_limit),
      price_per_lead = COALESCE(?, price_per_lead),
      subscription_price = COALESCE(?, subscription_price)
     WHERE id = ?`
  ).run(paid_mode, free_lead_limit, price_per_lead, subscription_price, req.params.id);
  res.json({ ok: true });
});

module.exports = router;
