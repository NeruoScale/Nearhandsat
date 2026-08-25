// README roadmap #7A, Phase I: admin-only candidate API.
//
// Every route here requires an authenticated admin -- candidate data must
// never be reachable through any public/client/artisan-facing endpoint
// (see routes/artisans.js and routes/services.js, neither of which touch
// this table). Deliberately minimal: list, one detail view (with its full
// provenance/history), a manual status transition for human review, and a
// manual discovery trigger. No communication/invitation/claim endpoints --
// out of scope for #7A.
const express = require("express");
const db = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const { ingestCandidates } = require("../discovery/ingest");
const { TRADES } = require("../constants/trades");

const router = express.Router();
router.use(requireAuth, requireRole("admin"));

const VALID_STATUSES = ["discovered", "qualified", "rejected", "duplicate", "invalid", "contact_ready"];

// GET /api/admin/candidates?status=&category=&country=&city=&limit=&offset=
router.get("/", async (req, res) => {
  const { status, category, country, city } = req.query;
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);

  const conditions = [];
  const params = [];
  if (status) {
    if (!VALID_STATUSES.includes(status)) return res.status(400).json({ error: "Invalid status filter." });
    conditions.push("status = ?");
    params.push(status);
  }
  if (category) {
    conditions.push("category_code = ?");
    params.push(category);
  }
  if (country) {
    conditions.push("country = ?");
    params.push(country);
  }
  if (city) {
    conditions.push("city = ?");
    params.push(city);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const total = (await db.prepare(`SELECT COUNT(*) AS c FROM candidates ${where}`).get(...params)).c;
  const results = await db
    .prepare(`SELECT * FROM candidates ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset);

  res.json({ results, total: Number(total), limit, offset });
});

// GET /api/admin/candidates/:id -- full detail: the candidate, every
// source that discovered it (provenance), and its full event history
// (distinct from its current status).
router.get("/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const candidate = await db.prepare("SELECT * FROM candidates WHERE id = ?").get(id);
  if (!candidate) return res.status(404).json({ error: "Candidate not found." });

  const sources = await db
    .prepare("SELECT * FROM candidate_sources WHERE candidate_id = ? ORDER BY id ASC")
    .all(id);
  const events = await db
    .prepare("SELECT * FROM candidate_events WHERE candidate_id = ? ORDER BY id ASC")
    .all(id);

  res.json({ ...candidate, sources, events });
});

// PUT /api/admin/candidates/:id/status -- the human-review action: an
// admin reads a candidate's flagged probable-duplicate/identity-match
// events (surfaced via GET /:id above) and decides where it lands. This
// is the ONLY way a candidate's status changes for a probable/uncertain
// signal -- the ingestion pipeline (Phase H) never does this
// automatically, by design.
router.put("/:id/status", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { status } = req.body || {};
  if (!VALID_STATUSES.includes(status)) return res.status(400).json({ error: "Invalid status." });

  const candidate = await db.prepare("SELECT * FROM candidates WHERE id = ?").get(id);
  if (!candidate) return res.status(404).json({ error: "Candidate not found." });

  await db.prepare("UPDATE candidates SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, id);
  await db
    .prepare(
      "INSERT INTO candidate_events (candidate_id, event_type, from_status, to_status, detail) VALUES (?,?,?,?,?)"
    )
    .run(id, "status_changed", candidate.status, status, JSON.stringify({ changed_by_admin_id: req.user.id }));

  res.json({ ok: true, status });
});

// POST /api/admin/candidates/discover -- manually triggers one discovery +
// ingestion run. No scheduler, no cron, no background worker: this is the
// only way discovery ever runs in #7A, exactly as scoped.
router.post("/discover", async (req, res) => {
  // areaAdminLevel: README roadmap #7C -- an explicit, optional opt-in for
  // a verified city-scoped Overpass query (see osmProvider.js). Omitted by
  // default, so every existing (country-level) call is unaffected.
  const { provider = "osm", country, category, city, limit, areaAdminLevel } = req.body || {};
  if (!country) return res.status(400).json({ error: "country is required." });
  if (!category || !TRADES.includes(category)) {
    return res.status(400).json({ error: "category must be one of the existing trade categories." });
  }

  try {
    const summary = await ingestCandidates(db, { provider, countryName: country, categoryCode: category, city, limit, areaAdminLevel });
    res.json(summary);
  } catch (err) {
    res.status(502).json({ error: `Discovery run failed: ${err.message}` });
  }
});

module.exports = router;
