const { Pool } = require("pg");

// Postgres is starting fresh (no historical rollout to replay), so every
// column the SQLite side accumulated incrementally via ensureColumn() is
// just part of the table from the start here -- no equivalent migration
// helper needed. portfolio_items.lead_id also gets ON DELETE CASCADE here,
// which the SQLite schema is missing (an inconsistency noted, not fixed,
// during the architecture audit).
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  role TEXT NOT NULL CHECK(role IN ('client','artisan','admin')),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  city TEXT,
  created_at TEXT DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS'),
  last_seen_at TEXT
);

CREATE TABLE IF NOT EXISTS artisan_profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  trade TEXT NOT NULL,
  bio TEXT DEFAULT '',
  city TEXT NOT NULL,
  avg_rating REAL DEFAULT 0,
  review_count INTEGER DEFAULT 0,
  jobs_completed INTEGER DEFAULT 0,
  leads_received INTEGER DEFAULT 0,
  latitude REAL,
  longitude REAL,
  service_radius_km INTEGER,
  country TEXT,
  state TEXT
);

-- leads must be created before portfolio_items -- unlike SQLite, Postgres
-- validates a REFERENCES target exists at CREATE TABLE time, and
-- portfolio_items.lead_id points at leads(id).
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  artisan_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'contacted' CHECK(status IN ('contacted','hired','completed','not_hired')),
  hire_source TEXT,
  created_at TEXT DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS'),
  hired_at TEXT,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS portfolio_items (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  artisan_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  note TEXT DEFAULT '',
  created_at TEXT DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS'),
  hidden INTEGER DEFAULT 0,
  lead_id INTEGER REFERENCES leads(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TEXT DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  client_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  artisan_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
  comment TEXT DEFAULT '',
  created_at TEXT DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS billing_settings (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
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
`;

if (!process.env.DATABASE_URL) {
  // db.js already checks this before requiring this module, but guard here
  // too in case this module is ever required directly.
  throw new Error("server/db-postgres.js requires DATABASE_URL to be set.");
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });

// Never let an idle client's network-level error (e.g. the connection
// dropping) crash the whole process via an unhandled 'error' event -- log
// just the message, never the pool config (which holds the credentials).
pool.on("error", (err) => {
  console.error("Postgres pool error:", err.message);
});

// Converts this app's SQLite-flavored query text (written once, shared by
// both backends) into Postgres-flavored text: `?` positional placeholders
// become `$1, $2, ...`, and the one SQLite-only function this codebase
// calls inline (`datetime('now')`) becomes a Postgres expression that
// still yields the exact same "YYYY-MM-DD HH:MM:SS" string shape -- so
// every column stays TEXT and the frontend's existing timestamp parsing
// (e.g. Profile.jsx's formatRelative, which appends "Z" to a plain
// string) keeps working unchanged. Native TIMESTAMPTZ was deliberately
// not used here: pg would hand back a JS Date, Express's JSON
// serialization would produce a full ISO string with a trailing "Z"
// already on it, and the frontend's "+ \"Z\"" logic would then produce a
// malformed double-Z string. Fixing that properly belongs with a
// frontend change, which is out of scope for this phase.
function translateSql(sql) {
  let translated = sql.replace(/datetime\('now'\)/gi, "TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')");
  let n = 0;
  translated = translated.replace(/\?/g, () => `$${++n}`);
  return translated;
}

// Same reasoning: booleans are kept as INTEGER 0/1 here, not native
// BOOLEAN, specifically so call sites like the portfolio hide/show toggle
// (`item.hidden ? 0 : 1`) keep working unchanged. Postgres does not
// implicitly cast an integer to boolean, so a real BOOLEAN column would
// require touching every call site that writes 0/1 -- deferred, same as
// the timestamp decision above, in the interest of "preserve existing
// application behavior" over "use the more idiomatic type" for this phase.

async function runQuery(sql, params, isRun) {
  let translated = translateSql(sql);
  if (isRun) {
    const insertMatch = /^\s*INSERT\s+INTO\s+(\w+)/i.exec(translated);
    // Every INSERT target in this app has a plain `id` primary key except
    // artisan_profiles (its PK is user_id, supplied by the caller, not
    // generated) -- skip the auto-RETURNING there, it would error.
    if (insertMatch && insertMatch[1].toLowerCase() !== "artisan_profiles" && !/RETURNING/i.test(translated)) {
      translated += " RETURNING id";
    }
  }
  return pool.query(translated, params);
}

// Schema setup + demo seed, kicked off once at module load. Every query
// issued through prepare() below awaits this before running, so no
// request can race an incomplete schema -- without requiring any change
// to server/index.js's startup sequencing.
const ready = (async function initSchema() {
  await pool.query(SCHEMA_SQL);
  await seedIfEmpty();
})().catch((err) => {
  console.error("Postgres schema initialization failed:", err.message);
  throw err;
});

async function seedIfEmpty() {
  const bcrypt = require("bcryptjs");
  const { rows } = await pool.query("SELECT COUNT(*) AS c FROM users");
  if (Number(rows[0].c) !== 0) return;

  const pw = bcrypt.hashSync("password123", 8);

  await pool.query(
    "INSERT INTO users (role, name, email, password_hash, city) VALUES ($1,$2,$3,$4,$5)",
    ["admin", "Platform Admin", "admin@nearhandsat.com", pw, null]
  );

  const clientIds = [];
  for (const [i, name] of ["Reda Haddad", "Sara Amrani", "Lina Benaissa"].entries()) {
    const { rows: r } = await pool.query(
      "INSERT INTO users (role, name, email, password_hash, city) VALUES ($1,$2,$3,$4,$5) RETURNING id",
      ["client", name, `client${i + 1}@example.com`, pw, "Setif"]
    );
    clientIds.push(r[0].id);
  }

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

  for (const a of artisans) {
    const { rows: ur } = await pool.query(
      "INSERT INTO users (role, name, email, password_hash, city) VALUES ($1,$2,$3,$4,$5) RETURNING id",
      ["artisan", a.name, `artisan${artisans.indexOf(a) + 1}@example.com`, pw, a.city]
    );
    const id = ur[0].id;
    await pool.query(
      "INSERT INTO artisan_profiles (user_id, trade, bio, city, avg_rating, review_count, jobs_completed, leads_received, country) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [id, a.trade, a.bio, a.city, a.rating, Math.max(1, Math.round(a.jobs / 8)), a.jobs, a.leads, "Algeria"]
    );
    for (const [label, note] of a.portfolio) {
      await pool.query("INSERT INTO portfolio_items (artisan_id, label, note) VALUES ($1,$2,$3)", [id, label, note]);
    }

    for (let j = 0; j < a.leads; j++) {
      const isHire = j < a.jobs;
      const clientId = clientIds[j % clientIds.length];
      if (isHire) {
        const { rows: lr } = await pool.query(
          "INSERT INTO leads (client_id, artisan_id, status, hired_at, completed_at) VALUES ($1,$2,'completed',$3,$4) RETURNING id",
          [clientId, id, "2026-06-01", "2026-06-10"]
        );
        if (j % 2 === 0) {
          await pool.query(
            "INSERT INTO reviews (lead_id, client_id, artisan_id, rating, comment) VALUES ($1,$2,$3,$4,$5)",
            [lr[0].id, clientId, id, Math.round(a.rating), "Solid, reliable work."]
          );
        }
      } else {
        await pool.query(
          "INSERT INTO leads (client_id, artisan_id, status) VALUES ($1,$2,'not_hired')",
          [clientId, id]
        );
      }
    }
  }

  for (const city of ["Setif", "El Eulma"]) {
    for (const cat of ["Electrician", "Plumber", "Painter", "Carpenter"]) {
      await pool.query(
        "INSERT INTO billing_settings (city, category, paid_mode, free_lead_limit) VALUES ($1,$2,$3,$4)",
        [city, cat, 0, 10]
      );
    }
  }

  console.log("Seeded PostgreSQL database with demo users (password for all: password123)");
}

function prepare(sql) {
  return {
    async get(...params) {
      await ready;
      const { rows } = await runQuery(sql, params, false);
      return rows[0];
    },
    async all(...params) {
      await ready;
      const { rows } = await runQuery(sql, params, false);
      return rows;
    },
    async run(...params) {
      await ready;
      const { rows, rowCount } = await runQuery(sql, params, true);
      return { changes: rowCount, lastInsertRowid: rows[0] ? rows[0].id : undefined };
    },
  };
}

module.exports = { prepare, ready, pool };
