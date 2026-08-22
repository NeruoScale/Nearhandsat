const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const path = require("path");

const dbPath = process.env.DB_PATH || path.join(__dirname, "nearhandsat.db");
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL CHECK(role IN ('client','artisan','admin')),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  city TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS artisan_profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  trade TEXT NOT NULL,
  bio TEXT DEFAULT '',
  city TEXT NOT NULL,
  avg_rating REAL DEFAULT 0,
  review_count INTEGER DEFAULT 0,
  jobs_completed INTEGER DEFAULT 0,
  leads_received INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS portfolio_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  artisan_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  note TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  artisan_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'contacted' CHECK(status IN ('contacted','hired','completed','not_hired')),
  hire_source TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  hired_at TEXT,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  client_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  artisan_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
  comment TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS billing_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  city TEXT NOT NULL,
  category TEXT NOT NULL,
  paid_mode INTEGER DEFAULT 0,
  free_lead_limit INTEGER DEFAULT 10,
  price_per_lead REAL DEFAULT 3.0,
  subscription_price REAL DEFAULT 15.0,
  UNIQUE(city, category)
);

CREATE INDEX IF NOT EXISTS idx_leads_artisan ON leads(artisan_id);
CREATE INDEX IF NOT EXISTS idx_leads_client ON leads(client_id);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_portfolio_artisan ON portfolio_items(artisan_id);
CREATE INDEX IF NOT EXISTS idx_reviews_artisan ON reviews(artisan_id);
CREATE INDEX IF NOT EXISTS idx_reviews_lead ON reviews(lead_id);
CREATE INDEX IF NOT EXISTS idx_messages_lead ON messages(lead_id);
`);

// Adds a column to an existing table if it isn't already there, so schema
// changes apply cleanly to a database that was created by an older version
// of this file without needing a separate migration runner.
function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn("portfolio_items", "hidden", "INTEGER DEFAULT 0");
ensureColumn("portfolio_items", "lead_id", "INTEGER REFERENCES leads(id)");
ensureColumn("users", "last_seen_at", "TEXT");
ensureColumn("artisan_profiles", "latitude", "REAL");
ensureColumn("artisan_profiles", "longitude", "REAL");
ensureColumn("artisan_profiles", "service_radius_km", "INTEGER");

ensureColumn("artisan_profiles", "country", "TEXT");
ensureColumn("artisan_profiles", "state", "TEXT");

// --- Seed data (only if empty) ---
const userCount = db.prepare("SELECT COUNT(*) AS c FROM users").get().c;
if (userCount === 0) {
  const insertUser = db.prepare(
    "INSERT INTO users (role, name, email, password_hash, city) VALUES (?,?,?,?,?)"
  );
  const insertProfile = db.prepare(
    "INSERT INTO artisan_profiles (user_id, trade, bio, city, avg_rating, review_count, jobs_completed, leads_received) VALUES (?,?,?,?,?,?,?,?)"
  );
  const insertPortfolio = db.prepare(
    "INSERT INTO portfolio_items (artisan_id, label, note) VALUES (?,?,?)"
  );
  const insertReview = db.prepare(
    "INSERT INTO reviews (lead_id, client_id, artisan_id, rating, comment) VALUES (?,?,?,?,?)"
  );
  const insertLead = db.prepare(
    "INSERT INTO leads (client_id, artisan_id, status, hired_at, completed_at) VALUES (?,?,?,?,?)"
  );

  const pw = bcrypt.hashSync("password123", 8);

  // admin
  insertUser.run("admin", "Platform Admin", "admin@nearhandsat.com", pw, null);

  // clients
  const clientIds = [];
  ["Reda Haddad", "Sara Amrani", "Lina Benaissa"].forEach((name, i) => {
    const info = insertUser.run(
      "client",
      name,
      `client${i + 1}@example.com`,
      pw,
      "Setif"
    );
    clientIds.push(info.lastInsertRowid);
  });

  // artisans
  const artisans = [
    { name: "Yasmine Boudiaf", trade: "Electrician", city: "Setif", bio: "Residential and small commercial wiring. 9 years on the tools, licensed and insured.", jobs: 47, leads: 61, rating: 4.9,
      portfolio: [["Kitchen rewire", "Full circuit replacement, 2026"], ["Panel upgrade", "200A service, 2025"], ["Shop lighting", "LED retrofit, 2025"]] },
    { name: "Karim Ferhat", trade: "Plumber", city: "Setif", bio: "Leak repair, bathroom fit-outs, water heater installs.", jobs: 33, leads: 40, rating: 4.7,
      portfolio: [["Bathroom re-pipe", "Copper to PEX, 2026"], ["Water heater swap", "Tankless unit, 2025"]] },
    { name: "Nadia Cherif", trade: "Painter", city: "Setif", bio: "Interior and exterior painting, decorative finishes, small crew.", jobs: 58, leads: 63, rating: 5.0,
      portfolio: [["Villa exterior", "Full repaint, 2026"], ["Accent wall", "Textured finish, 2025"], ["Office repaint", "3-day turnaround, 2025"]] },
    { name: "Omar Belkacem", trade: "Carpenter", city: "El Eulma", bio: "Custom cabinetry, furniture repair, built-in shelving.", jobs: 21, leads: 34, rating: 4.6,
      portfolio: [["Kitchen cabinets", "Built from scratch, 2025"], ["Bookshelf wall unit", "2024"]] },
    { name: "Farid Ouyahia", trade: "Electrician", city: "El Eulma", bio: "New to the platform. Trained electrician, competitive rates.", jobs: 12, leads: 29, rating: 4.4,
      portfolio: [["Outlet installation", "2025"]] },
    { name: "Lina Aouadi", trade: "Plumber", city: "Setif", bio: "Drain cleaning, fixture installs, emergency call-outs.", jobs: 26, leads: 27, rating: 4.8,
      portfolio: [["Kitchen sink install", "2026"], ["Drain unclog, commercial", "2025"]] },
  ];

  artisans.forEach((a, i) => {
    const info = insertUser.run(
      "artisan",
      a.name,
      `artisan${i + 1}@example.com`,
      pw,
      a.city
    );
    const id = info.lastInsertRowid;
    insertProfile.run(id, a.trade, a.bio, a.city, a.rating, Math.max(1, Math.round(a.jobs / 8)), a.jobs, a.leads);
    a.portfolio.forEach(([label, note]) => insertPortfolio.run(id, label, note));

    // synthetic historical leads/hires so ranking + admin stats have real rows to compute from
    for (let j = 0; j < a.leads; j++) {
      const isHire = j < a.jobs;
      const clientId = clientIds[j % clientIds.length];
      if (isHire) {
        const leadInfo = insertLead.run(clientId, id, "completed", "2026-06-01", "2026-06-10");
        if (j % 2 === 0) {
          insertReview.run(leadInfo.lastInsertRowid, clientId, id, Math.round(a.rating), "Solid, reliable work.");
        }
      } else {
        insertLead.run(clientId, id, "not_hired", null, null);
      }
    }
  });

  // default billing settings: off everywhere at launch
  const insertBilling = db.prepare(
    "INSERT INTO billing_settings (city, category, paid_mode, free_lead_limit) VALUES (?,?,?,?)"
  );
  ["Setif", "El Eulma"].forEach((city) => {
    ["Electrician", "Plumber", "Painter", "Carpenter"].forEach((cat) => {
      insertBilling.run(city, cat, 0, 10);
    });
  });

  console.log("Seeded database with demo users (password for all: password123)");
}

// All current seed/demo data is Algeria-based -- don't leave any row (seeded
// just now, or pre-existing from before this migration) with a blank country.
db.prepare("UPDATE artisan_profiles SET country = 'Algeria' WHERE country IS NULL").run();

module.exports = db;
