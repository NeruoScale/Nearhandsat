const express = require("express");
const fs = require("fs");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const media = require("../utils/media");

const router = express.Router();

// Serves a chat attachment only to a participant of the lead it belongs
// to -- never a public/static path. media.resolvePath() rejects anything
// that doesn't match the server-generated key shape before touching the
// filesystem, so this can't be used for path traversal even though the
// key arrives as a URL param.
router.get("/:key", requireAuth, async (req, res) => {
  const message = await db
    .prepare(
      `SELECT m.attachment_mime, l.client_id, l.artisan_id
       FROM messages m JOIN leads l ON l.id = m.lead_id
       WHERE m.attachment_key = ?`
    )
    .get(req.params.key);
  if (!message) return res.status(404).json({ error: "Attachment not found." });
  if (message.client_id !== req.user.id && message.artisan_id !== req.user.id) {
    return res.status(403).json({ error: "You're not part of this conversation." });
  }

  const filePath = media.resolvePath(req.params.key);
  if (!filePath || !fs.existsSync(filePath)) return res.status(404).json({ error: "Attachment not found." });

  res.setHeader("Content-Type", message.attachment_mime || "application/octet-stream");
  res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
  fs.createReadStream(filePath).pipe(res);
});

module.exports = router;
