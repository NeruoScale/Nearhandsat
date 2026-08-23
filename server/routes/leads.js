const express = require("express");
const db = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

// Client contacts an artisan -> creates a lead + first message. Roadmap #4:
// when serviceId is given, the artisan is derived from the service record on
// the server -- an artisanId in the request body is never trusted once a
// serviceId is present, so a client can't redirect a lead to a different
// professional than the one who actually owns the service. A generic
// contact with no serviceId (the pre-existing flow) still works exactly as
// before -- service_id is nullable precisely so this stays true.
router.post("/", requireAuth, requireRole("client"), async (req, res) => {
  const { artisanId, serviceId, message } = req.body || {};
  if (!message || !message.trim()) {
    return res.status(400).json({ error: "Choose a pro and write a message first." });
  }

  let finalArtisanId;
  let finalServiceId = null;

  if (serviceId) {
    const service = await db.prepare("SELECT * FROM services WHERE id = ?").get(serviceId);
    if (!service) return res.status(404).json({ error: "Service not found." });
    if (service.status !== "published") {
      return res.status(400).json({ error: "This service isn't currently available." });
    }
    finalArtisanId = service.artisan_id;
    finalServiceId = service.id;
  } else {
    if (!artisanId) return res.status(400).json({ error: "Choose a pro and write a message first." });
    const artisan = await db.prepare("SELECT user_id FROM artisan_profiles WHERE user_id = ?").get(artisanId);
    if (!artisan) return res.status(404).json({ error: "That pro couldn't be found." });
    finalArtisanId = artisanId;
  }

  // Duplicate-protection: a client may legitimately contact the same pro
  // more than once -- about a different service, or a follow-up job -- so
  // this only guards against an accidental rapid resubmit of the *same*
  // request (e.g. a double-clicked submit button on the same service/
  // contact), scoped to (client, artisan, service) rather than just
  // (client, artisan). Compared in JS, not SQL, since finalServiceId can be
  // null and null-vs-null equality in a parameterized `service_id = ?`
  // clause doesn't match the way a plain `=` comparison here does. Ordered
  // by id, not created_at: created_at has only second-level resolution, so
  // two leads created within the same second (routine under any real load,
  // not just tests) tie on created_at, and SQLite doesn't guarantee a
  // stable tie-break -- id is a true monotonic ordering.
  const recent = await db
    .prepare("SELECT created_at, service_id FROM leads WHERE client_id = ? AND artisan_id = ? ORDER BY id DESC LIMIT 1")
    .get(req.user.id, finalArtisanId);
  if (recent && recent.service_id === finalServiceId) {
    const recentMs = new Date(recent.created_at.replace(" ", "T") + "Z").getTime();
    if (Date.now() - recentMs < 60000) {
      return res.status(409).json({ error: "You just sent this request -- give it a moment before sending another." });
    }
  }

  const leadInfo = await db
    .prepare("INSERT INTO leads (client_id, artisan_id, service_id, status) VALUES (?,?,?,'contacted')")
    .run(req.user.id, finalArtisanId, finalServiceId);
  const leadId = leadInfo.lastInsertRowid;

  await db.prepare("INSERT INTO messages (lead_id, sender_id, content) VALUES (?,?,?)").run(
    leadId,
    req.user.id,
    message
  );
  await db.prepare(
    "UPDATE artisan_profiles SET leads_received = leads_received + 1 WHERE user_id = ?"
  ).run(finalArtisanId);

  res.status(201).json({ id: leadId, status: "contacted", service_id: finalServiceId });
});

// All leads visible to the current user -- serves both "client's own
// requests" and "professional's incoming requests" from one endpoint,
// filtered by whichever role the caller actually has.
router.get("/mine", requireAuth, async (req, res) => {
  const col = req.user.role === "artisan" ? "artisan_id" : "client_id";
  const rows = await db
    .prepare(
      `SELECT l.*, c.name AS client_name, a.name AS artisan_name, s.title AS service_title,
        (SELECT content FROM messages WHERE lead_id = l.id ORDER BY created_at ASC LIMIT 1) AS first_message
       FROM leads l
       JOIN users c ON c.id = l.client_id
       JOIN users a ON a.id = l.artisan_id
       LEFT JOIN services s ON s.id = l.service_id
       WHERE l.${col} = ?
       ORDER BY l.created_at DESC`
    )
    .all(req.user.id);
  res.json(rows);
});

// A single lead's own detail (no messages -- see GET /:id/messages for the
// conversation), ownership-checked the same way as every other lead
// endpoint. Distinct from /mine's list view.
router.get("/:id", requireAuth, async (req, res) => {
  const lead = await db
    .prepare(
      `SELECT l.*, c.name AS client_name, a.name AS artisan_name, s.title AS service_title
       FROM leads l
       JOIN users c ON c.id = l.client_id
       JOIN users a ON a.id = l.artisan_id
       LEFT JOIN services s ON s.id = l.service_id
       WHERE l.id = ?`
    )
    .get(req.params.id);
  if (!lead) return res.status(404).json({ error: "Lead not found." });
  if (lead.client_id !== req.user.id && lead.artisan_id !== req.user.id) {
    return res.status(403).json({ error: "You're not part of this conversation." });
  }
  res.json(lead);
});

function assertParticipant(req, res, lead) {
  if (!lead) {
    res.status(404).json({ error: "Conversation not found." });
    return false;
  }
  if (lead.client_id !== req.user.id && lead.artisan_id !== req.user.id) {
    res.status(403).json({ error: "You're not part of this conversation." });
    return false;
  }
  return true;
}

router.get("/:id/messages", requireAuth, async (req, res) => {
  const lead = await db.prepare("SELECT * FROM leads WHERE id = ?").get(req.params.id);
  if (!assertParticipant(req, res, lead)) return;
  const messages = await db
    .prepare("SELECT * FROM messages WHERE lead_id = ? ORDER BY created_at ASC")
    .all(req.params.id);
  res.json({ lead, messages });
});

router.post("/:id/messages", requireAuth, async (req, res) => {
  const lead = await db.prepare("SELECT * FROM leads WHERE id = ?").get(req.params.id);
  if (!assertParticipant(req, res, lead)) return;
  const { content } = req.body || {};
  if (!content) return res.status(400).json({ error: "Message can't be empty." });
  const info = await db.prepare("INSERT INTO messages (lead_id, sender_id, content) VALUES (?,?,?)").run(
    req.params.id,
    req.user.id,
    content
  );
  const message = await db.prepare("SELECT * FROM messages WHERE id = ?").get(info.lastInsertRowid);
  req.app.get("io").to(`lead:${req.params.id}`).emit("lead:message", message);
  res.status(201).json({ ok: true });
});

// Client confirms they hired this artisan -- the primary billable/ranking signal
router.post("/:id/hire", requireAuth, requireRole("client"), async (req, res) => {
  const lead = await db.prepare("SELECT * FROM leads WHERE id = ?").get(req.params.id);
  if (!assertParticipant(req, res, lead)) return;
  if (lead.status === "hired" || lead.status === "completed") {
    return res.status(400).json({ error: "This lead is already marked as hired." });
  }
  await db.prepare(
    "UPDATE leads SET status = 'hired', hire_source = 'client_confirmed', hired_at = datetime('now') WHERE id = ?"
  ).run(lead.id);
  await db.prepare(
    "UPDATE artisan_profiles SET jobs_completed = jobs_completed + 1 WHERE user_id = ?"
  ).run(lead.artisan_id);
  res.json({ ok: true, status: "hired" });
});

// Fallback: artisan self-reports a hire when the client never confirms.
// Trusted by default (low incentive to lie about winning a job), but
// tagged so the admin dashboard can watch for unusual patterns.
router.post("/:id/self-report", requireAuth, requireRole("artisan"), async (req, res) => {
  const lead = await db.prepare("SELECT * FROM leads WHERE id = ?").get(req.params.id);
  if (!assertParticipant(req, res, lead)) return;
  const { outcome } = req.body || {}; // 'hired' | 'not_hired'
  if (!["hired", "not_hired"].includes(outcome)) {
    return res.status(400).json({ error: "Outcome must be 'hired' or 'not_hired'." });
  }
  if (outcome === "hired") {
    await db.prepare(
      "UPDATE leads SET status = 'hired', hire_source = 'artisan_reported', hired_at = datetime('now') WHERE id = ?"
    ).run(lead.id);
    await db.prepare(
      "UPDATE artisan_profiles SET jobs_completed = jobs_completed + 1 WHERE user_id = ?"
    ).run(lead.artisan_id);
  } else {
    await db.prepare("UPDATE leads SET status = 'not_hired' WHERE id = ?").run(lead.id);
  }
  res.json({ ok: true, status: outcome });
});

// Mark a hired job as completed -- opens up the review flow
router.post("/:id/complete", requireAuth, async (req, res) => {
  const lead = await db.prepare("SELECT * FROM leads WHERE id = ?").get(req.params.id);
  if (!assertParticipant(req, res, lead)) return;
  if (lead.status !== "hired") {
    return res.status(400).json({ error: "Only hired jobs can be marked complete." });
  }
  await db.prepare("UPDATE leads SET status = 'completed', completed_at = datetime('now') WHERE id = ?").run(lead.id);
  res.json({ ok: true, status: "completed" });
});

module.exports = router;
