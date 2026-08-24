const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

// Paginated, newest first, scoped to the caller's own user_id -- never
// trusts a client-supplied user id anywhere in this file.
router.get("/", async (req, res) => {
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
  const total = (await db.prepare("SELECT COUNT(*) AS c FROM notifications WHERE user_id = ?").get(req.user.id)).c;
  // LEFT JOIN messages, not JOIN: a review_request notification (roadmap
  // #6) has no message_id, and an inner join would silently drop every
  // one of those rows from the list. sender_name falls back to the lead's
  // artisan when there's no message sender to name -- exactly right for
  // a "your job with [professional] is complete" notification.
  const results = await db
    .prepare(
      `SELECT n.*, l.service_id, s.title AS service_title,
        COALESCE(mu.name, au.name) AS sender_name, m.content AS message_preview
       FROM notifications n
       JOIN leads l ON l.id = n.lead_id
       LEFT JOIN services s ON s.id = l.service_id
       LEFT JOIN messages m ON m.id = n.message_id
       LEFT JOIN users mu ON mu.id = m.sender_id
       JOIN users au ON au.id = l.artisan_id
       WHERE n.user_id = ?
       ORDER BY n.created_at DESC, n.id DESC
       LIMIT ? OFFSET ?`
    )
    .all(req.user.id, limit, offset);
  res.json({ results, total: Number(total), limit, offset });
});

// A single indexed COUNT (idx_notifications_user_unread), not a
// maintained counter column -- simple and fast enough at this app's
// scale, and avoids a second source of truth that could drift from the
// notifications table itself.
router.get("/unread-count", async (req, res) => {
  const row = await db
    .prepare("SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read_at IS NULL")
    .get(req.user.id);
  res.json({ count: Number(row.c) });
});

router.put("/:id/read", async (req, res) => {
  const notification = await db
    .prepare("SELECT * FROM notifications WHERE id = ? AND user_id = ?")
    .get(req.params.id, req.user.id);
  if (!notification) return res.status(404).json({ error: "Notification not found." });
  await db.prepare("UPDATE notifications SET read_at = datetime('now') WHERE id = ?").run(notification.id);
  res.json({ ok: true });
});

router.post("/read-all", async (req, res) => {
  await db
    .prepare("UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL")
    .run(req.user.id);
  res.json({ ok: true });
});

module.exports = router;
