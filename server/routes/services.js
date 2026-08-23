const express = require("express");
const jwt = require("jsonwebtoken");
const db = require("../db");
const { requireAuth, requireRole, SECRET } = require("../middleware/auth");
const { TRADES } = require("../constants/trades");
const { resolveLocation, isWithinRadius } = require("../utils/geo");

const router = express.Router();

const PRICING_MODELS = ["fixed", "starting_at", "quote"];
const STATUSES = ["draft", "published", "archived"];

// Public endpoints (search, detail) accept an optional bearer token so an
// owning artisan can preview their own unpublished service -- but must not
// 401 an anonymous client, so this doesn't use requireAuth.
function optionalUser(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return null;
  try {
    return jwt.verify(token, SECRET);
  } catch {
    return null;
  }
}

// Validates only the fields present in `body` -- on a create (partial:
// false), title/category/pricing_model are required regardless; on a
// partial update, each field is checked only if the caller is actually
// setting it. The quote-vs-price cross-field rule (price is required
// unless pricing_model is "quote") is only enforced on create, where both
// fields are always known together; for a partial update, the route
// handler itself resolves the effective pricing_model/price pair against
// the existing stored row before writing, so a request that only changes
// e.g. the description never has to needlessly restate its price.
function validateServiceInput(body, { partial }) {
  const { title, category, pricing_model, price, currency } = body || {};

  if (!partial || title !== undefined) {
    if (!title || !String(title).trim()) return "Give this service a title.";
  }
  if (!partial || category !== undefined) {
    if (!TRADES.includes(category)) return "Choose a valid category.";
  }
  if (!partial || pricing_model !== undefined) {
    if (!PRICING_MODELS.includes(pricing_model)) return "Pricing model must be fixed, starting_at, or quote.";
  }
  if (price !== undefined && price !== null) {
    if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) {
      return "Price must be a positive number.";
    }
  }
  if (!partial && pricing_model !== "quote" && (price === undefined || price === null)) {
    return "Price is required unless the pricing model is 'quote'.";
  }
  if (currency !== undefined && currency !== null) {
    if (typeof currency !== "string" || currency.trim().length !== 3) {
      return "Currency must be a 3-letter code (e.g. DZD, USD, EUR).";
    }
  }
  return null;
}

function publicServiceFields(row) {
  const { latitude, longitude, service_radius_km, ...rest } = row;
  return rest;
}

// GET /api/services?category=&city=&country=&state=&artisanId=&q=&limit=&offset=
// Published-only, radius-aware exactly like GET /api/artisans -- reuses the
// same server/utils/geo.js eligibility logic, so a searched city surfaces
// services from professionals within their own configured travel radius,
// falling back to an exact city-text match when radius data isn't
// resolvable for a given professional (same explicit, non-silent rule as
// roadmap #2).
router.get("/", async (req, res) => {
  const { category, city, country, state, artisanId, q } = req.query;

  let rows = await db
    .prepare(
      `SELECT s.id, s.artisan_id, s.title, s.description, s.category, s.pricing_model, s.price, s.currency, s.created_at,
        u.name AS artisan_name, p.city, p.country, p.state, p.avg_rating, p.review_count,
        p.latitude, p.longitude, p.service_radius_km
       FROM services s
       JOIN users u ON u.id = s.artisan_id
       JOIN artisan_profiles p ON p.user_id = s.artisan_id
       WHERE s.status = 'published'`
    )
    .all();

  if (category && category !== "All") rows = rows.filter((r) => r.category === category);
  if (artisanId) rows = rows.filter((r) => String(r.artisan_id) === String(artisanId));

  if (city && city !== "All") {
    const searchLocation = resolveLocation({ country, state, city });
    rows = rows.filter((r) => {
      const eligible = isWithinRadius(searchLocation, r);
      return eligible === null ? r.city === city : eligible;
    });
  } else {
    if (country) rows = rows.filter((r) => r.country === country);
    if (state) rows = rows.filter((r) => r.state === state);
  }

  if (q) {
    const needle = q.toLowerCase();
    rows = rows.filter(
      (r) =>
        r.title.toLowerCase().includes(needle) ||
        r.description.toLowerCase().includes(needle) ||
        r.category.toLowerCase().includes(needle)
    );
  }

  rows.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  const total = rows.length;
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
  const results = rows.slice(offset, offset + limit).map(publicServiceFields);

  res.json({ results, total, limit, offset });
});

router.get("/mine", requireAuth, requireRole("artisan"), async (req, res) => {
  const rows = await db
    .prepare("SELECT * FROM services WHERE artisan_id = ? ORDER BY id DESC")
    .all(req.user.id);
  res.json(rows);
});

router.get("/:id", async (req, res) => {
  const row = await db
    .prepare(
      `SELECT s.*, u.name AS artisan_name, p.city, p.country, p.state
       FROM services s
       JOIN users u ON u.id = s.artisan_id
       JOIN artisan_profiles p ON p.user_id = s.artisan_id
       WHERE s.id = ?`
    )
    .get(req.params.id);
  if (!row) return res.status(404).json({ error: "Service not found." });

  if (row.status !== "published") {
    const user = optionalUser(req);
    if (!user || user.id !== row.artisan_id) {
      return res.status(404).json({ error: "Service not found." });
    }
  }

  res.json(publicServiceFields(row));
});

router.post("/", requireAuth, requireRole("artisan"), async (req, res) => {
  const error = validateServiceInput(req.body, { partial: false });
  if (error) return res.status(400).json({ error });

  const { title, description, category, pricing_model, price, currency } = req.body;
  const info = await db
    .prepare(
      `INSERT INTO services (artisan_id, title, description, category, pricing_model, price, currency, status)
       VALUES (?,?,?,?,?,?,?, 'draft')`
    )
    .run(
      req.user.id,
      title.trim(),
      description || "",
      category,
      pricing_model,
      pricing_model === "quote" ? null : price,
      currency ? currency.trim().toUpperCase() : "DZD"
    );

  const created = await db.prepare("SELECT * FROM services WHERE id = ?").get(info.lastInsertRowid);
  res.status(201).json(created);
});

async function ownedService(req, res) {
  const service = await db
    .prepare("SELECT * FROM services WHERE id = ? AND artisan_id = ?")
    .get(req.params.id, req.user.id);
  if (!service) {
    res.status(404).json({ error: "Service not found." });
    return null;
  }
  return service;
}

router.put("/:id", requireAuth, requireRole("artisan"), async (req, res) => {
  const service = await ownedService(req, res);
  if (!service) return;

  const error = validateServiceInput(req.body, { partial: true });
  if (error) return res.status(400).json({ error });

  const { title, description, category, pricing_model, price, currency } = req.body || {};
  const nextModel = pricing_model !== undefined ? pricing_model : service.pricing_model;
  const nextPrice =
    price !== undefined ? (nextModel === "quote" ? null : price) : nextModel === "quote" ? null : service.price;

  await db
    .prepare(
      `UPDATE services SET
        title = COALESCE(?, title),
        description = COALESCE(?, description),
        category = COALESCE(?, category),
        pricing_model = COALESCE(?, pricing_model),
        price = ?,
        currency = COALESCE(?, currency),
        updated_at = datetime('now')
       WHERE id = ?`
    )
    .run(
      title !== undefined ? title.trim() : null,
      description !== undefined ? description : null,
      category !== undefined ? category : null,
      pricing_model !== undefined ? pricing_model : null,
      nextPrice,
      currency !== undefined ? currency.trim().toUpperCase() : null,
      service.id
    );

  const updated = await db.prepare("SELECT * FROM services WHERE id = ?").get(service.id);
  res.json(updated);
});

router.put("/:id/status", requireAuth, requireRole("artisan"), async (req, res) => {
  const service = await ownedService(req, res);
  if (!service) return;

  const { status } = req.body || {};
  if (!STATUSES.includes(status)) {
    return res.status(400).json({ error: "Status must be draft, published, or archived." });
  }

  await db
    .prepare("UPDATE services SET status = ?, updated_at = datetime('now') WHERE id = ?")
    .run(status, service.id);
  res.json({ ok: true, status });
});

module.exports = router;
