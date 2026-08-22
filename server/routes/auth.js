const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("../db");
const { SECRET } = require("../middleware/auth");

const router = express.Router();

router.post("/register", async (req, res) => {
  const { role, name, email, password, city, country, state, trade, bio } = req.body || {};
  if (!role || !name || !email || !password) {
    return res.status(400).json({ error: "Name, email, password, and account type are required." });
  }
  if (!["client", "artisan"].includes(role)) {
    return res.status(400).json({ error: "Account type must be client or artisan." });
  }
  const existing = await db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (existing) return res.status(409).json({ error: "That email is already registered." });

  const hash = bcrypt.hashSync(password, 8);
  const info = await db
    .prepare("INSERT INTO users (role, name, email, password_hash, city) VALUES (?,?,?,?,?)")
    .run(role, name, email, hash, city || null);
  const userId = info.lastInsertRowid;

  if (role === "artisan") {
    if (!trade || !city || !country) {
      return res.status(400).json({ error: "Trade, country, and city are required for artisan accounts." });
    }
    await db.prepare(
      "INSERT INTO artisan_profiles (user_id, trade, bio, city, country, state) VALUES (?,?,?,?,?,?)"
    ).run(userId, trade, bio || "", city, country, state || null);
  }

  const token = jwt.sign({ id: userId, role, name }, SECRET, { expiresIn: "7d" });
  res.status(201).json({ token, user: { id: userId, role, name, email } });
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body || {};
  const user = await db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (!user || !bcrypt.compareSync(password || "", user.password_hash)) {
    return res.status(401).json({ error: "Incorrect email or password." });
  }
  const token = jwt.sign({ id: user.id, role: user.role, name: user.name }, SECRET, { expiresIn: "7d" });
  res.json({ token, user: { id: user.id, role: user.role, name: user.name, email: user.email } });
});

module.exports = router;
