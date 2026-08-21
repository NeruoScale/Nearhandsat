require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const http = require("http");
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const { SECRET } = require("./middleware/auth");
const { markOnline, markOffline } = require("./presence");

const db = require("./db"); // initializes + seeds sqlite db on first run

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
app.set("io", io);

// Auth the socket handshake with the same JWT used for REST requests.
io.use((socket, next) => {
  const token = socket.handshake.auth && socket.handshake.auth.token;
  if (!token) return next(new Error("Sign in required."));
  try {
    socket.user = jwt.verify(token, SECRET);
    next();
  } catch {
    next(new Error("Session expired. Sign in again."));
  }
});

io.on("connection", (socket) => {
  markOnline(socket.user.id);

  // Each lead conversation is a room; only its two participants may join.
  socket.on("lead:join", (leadId) => {
    const lead = db.prepare("SELECT * FROM leads WHERE id = ?").get(leadId);
    if (!lead) return;
    if (lead.client_id !== socket.user.id && lead.artisan_id !== socket.user.id) return;
    socket.join(`lead:${leadId}`);
  });

  socket.on("lead:leave", (leadId) => {
    socket.leave(`lead:${leadId}`);
  });

  socket.on("disconnect", () => {
    markOffline(socket.user.id);
    db.prepare("UPDATE users SET last_seen_at = datetime('now') WHERE id = ?").run(socket.user.id);
  });
});

app.use("/api/auth", require("./routes/auth"));
app.use("/api/artisans", require("./routes/artisans"));
app.use("/api/leads", require("./routes/leads"));
app.use("/api/reviews", require("./routes/reviews"));
app.use("/api/admin", require("./routes/admin"));

app.get("/api/health", (req, res) => res.json({ ok: true }));

const clientDist = path.join(__dirname, "..", "client", "dist");
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^(?!\/api\/).*/, (req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Something went wrong on our end." });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`NearHandsAT API running on http://localhost:${PORT}`));
