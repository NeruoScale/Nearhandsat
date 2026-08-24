const express = require("express");
const multer = require("multer");
const db = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const media = require("../utils/media");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: media.MAX_BYTES.video } });

// One conversations row per lead (README roadmap #5) -- upserted on every
// message rather than only at lead-creation time, so it's created "as part
// of the lead/job workflow" for brand-new leads AND backfills lazily for
// every lead created before this table existed, without a separate
// migration pass over historical data. Same INSERT ... ON CONFLICT syntax
// works unchanged on both SQLite and Postgres.
async function touchConversation(leadId) {
  await db
    .prepare(
      `INSERT INTO conversations (lead_id, updated_at) VALUES (?, datetime('now'))
       ON CONFLICT(lead_id) DO UPDATE SET updated_at = datetime('now')`
    )
    .run(leadId);
}

// Notifies whichever participant did NOT send this message. Contains
// enough context (service, lead, sender) for the recipient to identify
// what the notification is about without a follow-up request.
async function notifyNewMessage(req, lead, message) {
  const recipientId = message.sender_id === lead.client_id ? lead.artisan_id : lead.client_id;
  const info = await db
    .prepare("INSERT INTO notifications (user_id, type, lead_id, message_id) VALUES (?, 'new_message', ?, ?)")
    .run(recipientId, lead.id, message.id);
  const notification = await db
    .prepare(
      `SELECT n.*, l.service_id, s.title AS service_title, u.name AS sender_name
       FROM notifications n
       JOIN leads l ON l.id = n.lead_id
       LEFT JOIN services s ON s.id = l.service_id
       JOIN messages m ON m.id = n.message_id
       JOIN users u ON u.id = m.sender_id
       WHERE n.id = ?`
    )
    .get(info.lastInsertRowid);
  req.app.get("io").to(`user:${recipientId}`).emit("notification:new", notification);
}

// README roadmap #6: notifies the client that their completed job is ready
// to review. No message is involved, hence message_id is NULL here --
// notifications.message_id was made nullable specifically for this. Reuses
// the exact same table/route/socket-event/NotificationBell UI as
// notifyNewMessage above -- sender_name carries the professional's name so
// the client-side rendering needs no new field, only a type-aware label.
async function notifyReviewRequest(req, lead) {
  const info = await db
    .prepare("INSERT INTO notifications (user_id, type, lead_id, message_id) VALUES (?, 'review_request', ?, NULL)")
    .run(lead.client_id, lead.id);
  const notification = await db
    .prepare(
      `SELECT n.*, l.service_id, s.title AS service_title, a.name AS sender_name
       FROM notifications n
       JOIN leads l ON l.id = n.lead_id
       LEFT JOIN services s ON s.id = l.service_id
       JOIN users a ON a.id = l.artisan_id
       WHERE n.id = ?`
    )
    .get(info.lastInsertRowid);
  req.app.get("io").to(`user:${lead.client_id}`).emit("notification:new", notification);
}

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

  const msgInfo = await db.prepare("INSERT INTO messages (lead_id, sender_id, content) VALUES (?,?,?)").run(
    leadId,
    req.user.id,
    message
  );
  await db.prepare(
    "UPDATE artisan_profiles SET leads_received = leads_received + 1 WHERE user_id = ?"
  ).run(finalArtisanId);

  await touchConversation(leadId);
  const firstMessage = await db.prepare("SELECT * FROM messages WHERE id = ?").get(msgInfo.lastInsertRowid);
  await notifyNewMessage(req, { id: leadId, client_id: req.user.id, artisan_id: finalArtisanId }, firstMessage);

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

// README roadmap #6: the review for a lead, if one exists -- lets the
// client's own UI know whether they've already reviewed this job (so
// MyLeads.jsx can stop offering "LEAVE A REVIEW" once one exists) and lets
// the professional see the review on their own job. Either participant may
// read it; only POST /api/reviews (client-only, completed-lead-only) can
// create one.
router.get("/:id/review", requireAuth, async (req, res) => {
  const lead = await db.prepare("SELECT * FROM leads WHERE id = ?").get(req.params.id);
  if (!assertParticipant(req, res, lead)) return;
  const review = await db.prepare("SELECT * FROM reviews WHERE lead_id = ?").get(req.params.id);
  res.json(review || null);
});

// Paginated, newest-page-last (ascending overall, matching chat UI order)
// so the browser never has to load a lead's entire history at once.
// Viewing a page marks the other participant's messages on it as read --
// this is the "view the conversation" trigger the read-state requirement
// asks for; there's no separate "mark as read" endpoint because reading
// IS viewing, in a two-party thread.
router.get("/:id/messages", requireAuth, async (req, res) => {
  const lead = await db.prepare("SELECT * FROM leads WHERE id = ?").get(req.params.id);
  if (!assertParticipant(req, res, lead)) return;

  // Mark-as-read runs BEFORE the message/notification SELECTs below, not
  // after -- otherwise the JSON response for this exact call would still
  // reflect the pre-update (unread) state even though the DB was already
  // correctly updated, and the caller would only see the change on their
  // *next* fetch.
  await db
    .prepare("UPDATE messages SET read_at = datetime('now') WHERE lead_id = ? AND sender_id != ? AND read_at IS NULL")
    .run(req.params.id, req.user.id);
  // Viewing the conversation also clears the notifications it generated for
  // this user -- otherwise "message read" and "notification read" would be
  // two silently-independent states and the unread badge would never clear
  // just from reading the thread.
  await db
    .prepare("UPDATE notifications SET read_at = datetime('now') WHERE lead_id = ? AND user_id = ? AND read_at IS NULL")
    .run(req.params.id, req.user.id);

  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 30));
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
  const total = (await db.prepare("SELECT COUNT(*) AS c FROM messages WHERE lead_id = ?").get(req.params.id)).c;
  const page = await db
    .prepare("SELECT * FROM messages WHERE lead_id = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?")
    .all(req.params.id, limit, offset);
  const messages = page.reverse();

  res.json({ lead, messages, total: Number(total), limit, offset });
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
  await touchConversation(lead.id);
  await notifyNewMessage(req, lead, message);
  req.app.get("io").to(`lead:${req.params.id}`).emit("lead:message", message);
  res.status(201).json({ ok: true });
});

// Image/video attachment message. Multipart (multer), not JSON, so this is
// a separate route from the text-message endpoint above rather than
// overloading it with two request body formats -- the existing text flow
// is untouched. media.validate() enforces the MIME allowlist and per-kind
// size cap before anything is written to disk.
// multer throws synchronously for an oversized file, before this route's
// own handler ever runs -- wrapped here so that surfaces as this app's
// normal 400 {error} shape instead of falling through to index.js's
// generic 500 handler.
function uploadSingle(req, res, next) {
  upload.single("file")(req, res, (err) => {
    if (err) return res.status(400).json({ error: "File is too large or malformed." });
    next();
  });
}

router.post("/:id/attachments", requireAuth, uploadSingle, async (req, res) => {
  const lead = await db.prepare("SELECT * FROM leads WHERE id = ?").get(req.params.id);
  if (!assertParticipant(req, res, lead)) return;

  if (!req.file) return res.status(400).json({ error: "No file uploaded." });
  const error = media.validate(req.file.mimetype, req.file.size);
  if (error) return res.status(400).json({ error });

  const { key, messageType } = media.save(req.file.buffer, req.file.mimetype);
  const info = await db
    .prepare(
      "INSERT INTO messages (lead_id, sender_id, content, message_type, attachment_key, attachment_mime) VALUES (?,?,?,?,?,?)"
    )
    .run(req.params.id, req.user.id, req.body.caption || "", messageType, key, req.file.mimetype);
  const message = await db.prepare("SELECT * FROM messages WHERE id = ?").get(info.lastInsertRowid);
  await touchConversation(lead.id);
  await notifyNewMessage(req, lead, message);
  req.app.get("io").to(`lead:${req.params.id}`).emit("lead:message", message);
  res.status(201).json(message);
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

// Mark a hired job as completed -- opens up the review flow.
//
// README roadmap #6: this used to be reachable by either participant
// (requireAuth + assertParticipant, which accepts client_id OR
// artisan_id) -- and the client-facing UI (MyLeads.jsx) was in fact the
// only place that called it, meaning the *client* was the one completing
// jobs, not the professional. Fixed here: requireRole("artisan") plus an
// explicit lead.artisan_id === req.user.id check (assertParticipant is
// deliberately not reused, since it would still accept the client).
// MyLeads.jsx's "MARK JOB COMPLETE" button is removed as part of this fix;
// ArtisanDashboard.jsx gains the equivalent professional-facing action.
router.post("/:id/complete", requireAuth, requireRole("artisan"), async (req, res) => {
  const lead = await db.prepare("SELECT * FROM leads WHERE id = ?").get(req.params.id);
  if (!lead) return res.status(404).json({ error: "Lead not found." });
  if (lead.artisan_id !== req.user.id) {
    return res.status(403).json({ error: "Only the professional on this job can mark it complete." });
  }
  if (lead.status !== "hired") {
    return res.status(400).json({ error: "Only hired jobs can be marked complete." });
  }
  await db.prepare("UPDATE leads SET status = 'completed', completed_at = datetime('now') WHERE id = ?").run(lead.id);
  await notifyReviewRequest(req, lead);
  res.json({ ok: true, status: "completed" });
});

module.exports = router;
