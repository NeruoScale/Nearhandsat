const jwt = require("jsonwebtoken");
const SECRET = process.env.JWT_SECRET || "dev-secret-change-in-production";

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Sign in required." });
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Session expired. Sign in again." });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Not allowed for this account type." });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole, SECRET };
