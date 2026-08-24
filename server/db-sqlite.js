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

-- README roadmap #5: chat & notifications. One conversation per lead
-- (1:1) -- service/client/artisan are deliberately not duplicated here,
-- derived via lead_id -> leads exactly like leads.service_id -> services
-- already does. messages.lead_id itself remains the actual join key for
-- the message thread (unchanged) and the Socket.IO room name (lead:<id>,
-- unchanged) -- this table exists to track thread-level activity
-- (updated_at) separately from the lead's own business-status timestamps.
CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL UNIQUE REFERENCES leads(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- README roadmap #6: message_id is nullable and 'review_request' is a valid
-- type from the start here -- a completion event has no associated
-- message. (A database that already has this table from roadmap #5, where
-- message_id was NOT NULL and only 'new_message' was valid, gets migrated
-- below via ensureColumn/table-rebuild, since SQLite can't ALTER a
-- column's NOT NULL or CHECK constraints in place.)
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'new_message' CHECK(type IN ('new_message','review_request')),
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  message_id INTEGER REFERENCES messages(id) ON DELETE CASCADE,
  read_at TEXT,
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

-- README roadmap #3: structured services & offers. Location is deliberately
-- not duplicated here -- eligibility/discovery joins back to artisan_profiles
-- (city/country/state/latitude/longitude/service_radius_km), reusing the
-- roadmap #2 geo utility as-is.
CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  artisan_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  category TEXT NOT NULL,
  pricing_model TEXT NOT NULL CHECK(pricing_model IN ('fixed','starting_at','quote')),
  price REAL,
  currency TEXT NOT NULL DEFAULT 'DZD',
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','archived')),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT
);

-- README roadmap #7A, Phase A: category taxonomy foundation. Purely
-- additive lookup table layered on top of the existing trade strings --
-- 'code' is the exact existing artisan_profiles.trade / services.category /
-- billing_settings.category string value, never a new/renamed identifier.
-- No existing column, query, or data changes as a result of this table.
CREATE TABLE IF NOT EXISTS categories (
  code TEXT PRIMARY KEY,
  name_en TEXT NOT NULL,
  name_fr TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  parent_code TEXT REFERENCES categories(code),
  created_at TEXT DEFAULT (datetime('now'))
);

-- README roadmap #7A, Phase C: candidate schema (external professional
-- discovery). Deliberately has NO foreign key to users/artisan_profiles --
-- a candidate is not a registered professional, and this table must never
-- imply otherwise. category_code is the only link to existing marketplace
-- data (the roadmap #7A Phase A categories table), and is nullable since a
-- discovery source doesn't always map cleanly to one of our 25 trades.
-- Country-required, city/state optional: mirrors artisan_profiles' own
-- global location model (see server/utils/geo.js) rather than inventing a
-- new one. duplicate_of_candidate_id is a self-reference used by roadmap
-- #7A Phase E's dedup logic to point a duplicate at the candidate it was
-- merged into, without ever deleting the duplicate row.
CREATE TABLE IF NOT EXISTS candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_code TEXT REFERENCES categories(code),
  display_name TEXT,
  normalized_name TEXT,
  country TEXT NOT NULL,
  state TEXT,
  city TEXT,
  address_raw TEXT,
  latitude REAL,
  longitude REAL,
  phone TEXT,
  phone_normalized TEXT,
  email TEXT,
  website TEXT,
  website_domain TEXT,
  status TEXT NOT NULL DEFAULT 'discovered' CHECK(status IN ('discovered','qualified','rejected','duplicate','invalid','contact_ready')),
  duplicate_of_candidate_id INTEGER REFERENCES candidates(id),
  first_discovered_at TEXT DEFAULT (datetime('now')),
  last_seen_at TEXT DEFAULT (datetime('now')),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT
);

-- Provenance: many-to-one, NOT a single candidates.source column -- the
-- same real-world candidate can be independently discovered by more than
-- one source/provider, and every one of those sightings must stay
-- individually attributable (attribution/license obligations differ per
-- provider, e.g. OSM's ODbL). raw_payload is intentionally NOT "whatever
-- the provider returned" -- callers store only the specific fields actually
-- used, per the "do not persist raw provider payloads unnecessarily"
-- constraint. The UNIQUE constraint makes re-ingesting the same
-- provider/external_id a no-op rather than a duplicate row.
CREATE TABLE IF NOT EXISTS candidate_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  external_id TEXT,
  source_url TEXT,
  license TEXT,
  raw_payload TEXT,
  fetched_at TEXT DEFAULT (datetime('now')),
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(provider, external_id)
);

-- History log, distinct from candidates.status -- status is "where a
-- candidate is right now," this is "everything that happened to it."
-- detail is free-text (JSON-encoded by callers) rather than structured
-- columns, e.g. for an 'identity_match_found' event: {"matched_user_id":5,
-- "signals":["phone"]} -- deliberately NOT a real FK to users, so this
-- table can record a *possible* match for admin review without ever
-- wiring candidates to real accounts at the schema level.
CREATE TABLE IF NOT EXISTS candidate_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  detail TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_candidates_status ON candidates(status);
CREATE INDEX IF NOT EXISTS idx_candidates_category ON candidates(category_code);
CREATE INDEX IF NOT EXISTS idx_candidates_country_city ON candidates(country, city);
CREATE INDEX IF NOT EXISTS idx_candidates_phone_normalized ON candidates(phone_normalized);
CREATE INDEX IF NOT EXISTS idx_candidates_website_domain ON candidates(website_domain);
CREATE INDEX IF NOT EXISTS idx_candidate_sources_candidate ON candidate_sources(candidate_id);
CREATE INDEX IF NOT EXISTS idx_candidate_events_candidate ON candidate_events(candidate_id);

CREATE INDEX IF NOT EXISTS idx_leads_artisan ON leads(artisan_id);
CREATE INDEX IF NOT EXISTS idx_leads_client ON leads(client_id);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_portfolio_artisan ON portfolio_items(artisan_id);
CREATE INDEX IF NOT EXISTS idx_reviews_artisan ON reviews(artisan_id);
CREATE INDEX IF NOT EXISTS idx_reviews_lead ON reviews(lead_id);
CREATE INDEX IF NOT EXISTS idx_messages_lead ON messages(lead_id);
CREATE INDEX IF NOT EXISTS idx_services_artisan ON services(artisan_id);
CREATE INDEX IF NOT EXISTS idx_services_status ON services(status);
CREATE INDEX IF NOT EXISTS idx_services_category ON services(category);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, read_at);
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

// README roadmap #7A, Phase B: nullable, optional phone -- no existing
// account is required to have one, and none is backfilled. Applies to
// both roles (client and artisan), same as email, since a future phase's
// NearHandsAT-identity matching needs it regardless of role. Never
// selected by any public-facing query (see routes/artisans.js).
ensureColumn("users", "phone", "TEXT");
db.exec("CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone)");

// README roadmap #4: nullable so every pre-existing lead (created before
// this column existed, or via the generic "Contact" flow with no specific
// service selected) stays valid -- the service link is additive, not
// required.
ensureColumn("leads", "service_id", "INTEGER REFERENCES services(id)");
db.exec("CREATE INDEX IF NOT EXISTS idx_leads_service ON leads(service_id)");

// README roadmap #5: chat & notifications. attachment_key is a
// server-generated storage key (never a client-supplied filename) into the
// Railway volume mounted at /data -- see server/utils/media.js. read_at is
// nullable: a message is unread until the recipient views the conversation.
ensureColumn("messages", "message_type", "TEXT NOT NULL DEFAULT 'text' CHECK(message_type IN ('text','image','video'))");
ensureColumn("messages", "attachment_key", "TEXT");
ensureColumn("messages", "attachment_mime", "TEXT");
ensureColumn("messages", "read_at", "TEXT");

// README roadmap #6: job completion + reviews.
// A lead can have at most one review -- enforced at the DB level (the
// route already checked this at the application level, but that alone
// can't prevent a race between two near-simultaneous requests).
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_lead_unique ON reviews(lead_id)");

// If notifications still has the roadmap #5 shape (message_id NOT NULL,
// only 'new_message' allowed), rebuild it -- SQLite can't ALTER a
// column's NOT NULL or CHECK constraints in place. A brand-new database
// never hits this: the CREATE TABLE IF NOT EXISTS above already creates
// the roadmap #6 shape directly.
{
  const notifCols = db.prepare("PRAGMA table_info(notifications)").all();
  const messageIdCol = notifCols.find((c) => c.name === "message_id");
  if (messageIdCol && messageIdCol.notnull === 1) {
    db.exec(`
      CREATE TABLE notifications_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type TEXT NOT NULL DEFAULT 'new_message' CHECK(type IN ('new_message','review_request')),
        lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
        message_id INTEGER REFERENCES messages(id) ON DELETE CASCADE,
        read_at TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
      INSERT INTO notifications_new SELECT id, user_id, type, lead_id, message_id, read_at, created_at FROM notifications;
      DROP TABLE notifications;
      ALTER TABLE notifications_new RENAME TO notifications;
      CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
      CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, read_at);
    `);
  }
}

// README roadmap #7A, Phase A: category taxonomy seed. Runs on every boot
// (not just "if empty" like the demo data below) via INSERT OR IGNORE, so
// it stays in sync if a new trade is ever added to TRADES, without needing
// a one-off migration each time. Never overwrites an existing row.
{
  const { CATEGORIES } = require("./constants/categories");
  const insertCategory = db.prepare(
    "INSERT OR IGNORE INTO categories (code, name_en, name_fr, name_ar, parent_code) VALUES (?,?,?,?,?)"
  );
  for (const c of CATEGORIES) {
    insertCategory.run(c.code, c.name_en, c.name_fr, c.name_ar, c.parent_code);
  }
}

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
