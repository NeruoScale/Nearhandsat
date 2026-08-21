const express = require("express");
const db = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

// Client contacts an artisan -> creates a lead + first message
router.post("/", requireAuth, requireRole("client"), (req, res) => {
  const { artisanId, message } = req.body || {};
  if (!artisanId || !message) {
    return res.status(400).json({ error: "Choose a pro and write a message first." });
  }
  const artisan = db.prepare("SELECT user_id FROM artisan_profiles WHERE user_id = ?").get(artisanId);
  if (!artisan) return res.status(404).json({ error: "That pro couldn't be found." });

  const leadInfo = db
    .prepare("INSERT INTO leads (client_id, artisan_id, status) VALUES (?,?,'contacted')")
    .run(req.user.id, artisanId);
  const leadId = leadInfo.lastInsertRowid;

  db.prepare("INSERT INTO messages (lead_id, sender_id, content) VALUES (?,?,?)").run(
    leadId,
    req.user.id,
    message
  );
  db.prepare(
    "UPDATE artisan_profiles SET leads_received = leads_received + 1 WHERE user_id = ?"
  ).run(artisanId);

  res.status(201).json({ id: leadId, status: "contacted" });
});

// All leads visible to the current user (as client or artisan)
router.get("/mine", requireAuth, (req, res) => {
  const col = req.user.role === "artisan" ? "artisan_id" : "client_id";
  const rows = db
    .prepare(
      `SELECT l.*, c.name AS client_name, a.name AS artisan_name,
        (SELECT content FROM messages WHERE lead_id = l.id ORDER BY created_at ASC LIMIT 1) AS first_message
       FROM leads l
       JOIN users c ON c.id = l.client_id
       JOIN users a ON a.id = l.artisan_id
       WHERE l.${col} = ?
       ORDER BY l.created_at DESC`
    )
    .all(req.user.id);
  res.json(rows);
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

router.get("/:id/messages", requireAuth, (req, res) => {
  const lead = db.prepare("SELECT * FROM leads WHERE id = ?").get(req.params.id);
  if (!assertParticipant(req, res, lead)) return;
  const messages = db
    .prepare("SELECT * FROM messages WHERE lead_id = ? ORDER BY created_at ASC")
    .all(req.params.id);
  res.json({ lead, messages });
});

router.post("/:id/messages", requireAuth, (req, res) => {
  const lead = db.prepare("SELECT * FROM leads WHERE id = ?").get(req.params.id);
  if (!assertParticipant(req, res, lead)) return;
  const { content } = req.body || {};
  if (!content) return res.status(400).json({ error: "Message can't be empty." });
  const info = db.prepare("INSERT INTO messages (lead_id, sender_id, content) VALUES (?,?,?)").run(
    req.params.id,
    req.user.id,
    content
  );
  const message = db.prepare("SELECT * FROM messages WHERE id = ?").get(info.lastInsertRowid);
  req.app.get("io").to(`lead:${req.params.id}`).emit("lead:message", message);
  res.status(201).json({ ok: true });
});

// Client confirms they hired this artisan -- the primary billable/ranking signal
router.post("/:id/hire", requireAuth, requireRole("client"), (req, res) => {
  const lead = db.prepare("SELECT * FROM leads WHERE id = ?").get(req.params.id);
  if (!assertParticipant(req, res, lead)) return;
  if (lead.status === "hired" || lead.status === "completed") {
    return res.status(400).json({ error: "This lead is already marked as hired." });
  }
  db.prepare(
    "UPDATE leads SET status = 'hired', hire_source = 'client_confirmed', hired_at = datetime('now') WHERE id = ?"
  ).run(lead.id);
  db.prepare(
    "UPDATE artisan_profiles SET jobs_completed = jobs_completed + 1 WHERE user_id = ?"
  ).run(lead.artisan_id);
  res.json({ ok: true, status: "hired" });
});

// Fallback: artisan self-reports a hire when the client never confirms.
// Trusted by default (low incentive to lie about winning a job), but
// tagged so the admin dashboard can watch for unusual patterns.
router.post("/:id/self-report", requireAuth, requireRole("artisan"), (req, res) => {
  const lead = db.prepare("SELECT * FROM leads WHERE id = ?").get(req.params.id);
  if (!assertParticipant(req, res, lead)) return;
  const { outcome } = req.body || {}; // 'hired' | 'not_hired'
  if (!["hired", "not_hired"].includes(outcome)) {
    return res.status(400).json({ error: "Outcome must be 'hired' or 'not_hired'." });
  }
  if (outcome === "hired") {
    db.prepare(
      "UPDATE leads SET status = 'hired', hire_source = 'artisan_reported', hired_at = datetime('now') WHERE id = ?"
    ).run(lead.id);
    db.prepare(
      "UPDATE artisan_profiles SET jobs_completed = jobs_completed + 1 WHERE user_id = ?"
    ).run(lead.artisan_id);
  } else {
    db.prepare("UPDATE leads SET status = 'not_hired' WHERE id = ?").run(lead.id);
  }
  res.json({ ok: true, status: outcome });
});

// Mark a hired job as completed -- opens up the review flow
router.post("/:id/complete", requireAuth, (req, res) => {
  const lead = db.prepare("SELECT * FROM leads WHERE id = ?").get(req.params.id);
  if (!assertParticipant(req, res, lead)) return;
  if (lead.status !== "hired") {
    return res.status(400).json({ error: "Only hired jobs can be marked complete." });
  }
  db.prepare("UPDATE leads SET status = 'completed', completed_at = datetime('now') WHERE id = ?").run(lead.id);
  res.json({ ok: true, status: "completed" });
});

module.exports = router;
