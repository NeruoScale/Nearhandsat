# NearHandsAT

A marketplace connecting artisans & tradespeople ("AT") with clients — full-stack demo covering
profiles, search, in-app messaging, hire confirmation, reviews, a ranking algorithm, and an
admin dashboard with monetization controls.

## Stack

- **Backend**: Node.js + Express + SQLite (via `better-sqlite3` — a single-file database, no
  server setup needed). Swap in Postgres for production by changing `server/db.js`.
- **Real-time**: `socket.io` on both the server (`server/index.js`, wrapping Express in a plain
  `http.Server`) and the client (`socket.io-client`, via `client/src/socket.js`). The socket
  handshake is authenticated with the same JWT as REST requests. In dev, Vite proxies both `/api`
  and `/socket.io` to the backend on port 4000; in production both HTTP and WebSocket traffic run
  on the same single port.
- **Frontend**: React + Vite, plain CSS with design tokens (no Tailwind/build-step dependency).
- **Auth**: JWT, bcrypt-hashed passwords.

## Quick start

Requires Node.js 18+.

```bash
# 1. Backend
cd server
npm install
npm start
# API runs on http://localhost:4000 and auto-creates + seeds nearhandsat.db on first run

# 2. Frontend (in a new terminal)
cd client
npm install
npm run dev
# App runs on http://localhost:5173 and proxies /api to the backend
```

Open http://localhost:5173.

### Demo accounts
Password for all: `password123`

| Role | Email |
|---|---|
| Client | client1@example.com |
| Artisan | artisan1@example.com |
| Admin | admin@nearhandsat.com |

Or register a new account from the sign-in screen.

## What's implemented

- **Auth** — client / artisan / admin roles, JWT sessions
- **Artisan profiles** — trade, city, bio, portfolio (add work items), aggregate rating
- **Search & filters** — category, city, minimum rating, free-text search, ranked results
- **In-app messaging, real-time** — contact stays inside the app until a hire is confirmed;
  messages arrive live over a per-lead `socket.io` room (`lead:<id>`) instead of manual refetching.
  REST endpoints remain the source of truth for the initial thread load and as a fallback if the
  socket connection drops.
- **Online/offline presence** — an artisan's public profile shows a live "Online now" indicator or
  "Last seen <relative time>", backed by an in-memory connection-count map (`server/presence.js`)
  and a `last_seen_at` timestamp written on disconnect.
- **Hire confirmation flow** — client taps "I hired them"; this is both the billing signal and
  the ranking signal
- **Fallback self-report** — if a client never confirms, the artisan can self-report the outcome;
  flagged patterns (high leads, low confirmed-hire ratio) surface in the admin dashboard rather
  than being silently penalized
- **Artisan dashboard, expanded** — each request row shows a message preview, status, and date,
  and expands into the full live conversation with self-report actions where relevant; a "Your
  reviews" section surfaces the artisan's own reviews without leaving the dashboard.
- **Portfolio management** — edit or hide/show each portfolio item. Hiding a freeform item is
  cosmetic only; hiding one linked to a confirmed job (`lead_id` set) lowers `jobs_completed`
  (floored at 0) and the ranking score, with a confirmation dialog and a persistent banner showing
  the before/after job count so the impact is never a silent change. Hidden items are excluded
  from the public profile.
- **Location & service area** — an artisan's `city` stays the primary free-text display/search
  field; they can additionally share a precise location via the browser Geolocation API (behind an
  explanatory prompt, never requested silently) and set a service radius ("how far will you
  travel? (km)"), shown on the public profile as e.g. "Setif · travels up to 15km." Latitude/
  longitude are captured for a future radius-based search but not exposed by any API response.
- **Reviews** — only unlockable after a lead reaches `completed` status, one per lead
- **Ranking algorithm** (`server/utils/ranking.js`) — weights rating + jobs done always; only
  factors in lead-to-hire conversion once an artisan has 10+ leads, so new profiles aren't
  punished for a small sample size
- **Admin dashboard** — platform totals, conversion by city/category, flagged accounts, and a
  per-city/per-category "paid mode" toggle with free-lead limits and pricing — off by default,
  matching the free-then-paid rollout plan

## Schema additions

Beyond the base tables (`users`, `artisan_profiles`, `portfolio_items`, `leads`, `messages`,
`reviews`, `billing_settings`), `server/db.js` applies these columns at boot via an `ensureColumn`
helper (checks `PRAGMA table_info` and runs `ALTER TABLE ... ADD COLUMN` only if missing, so it's
safe against an already-seeded database):

- `portfolio_items.hidden` (`INTEGER DEFAULT 0`) — cosmetic hide/show, excluded from the public
  profile when `1`
- `portfolio_items.lead_id` (`INTEGER REFERENCES leads(id)`, nullable) — links a portfolio item to
  the confirmed job it represents, when there is one; drives the score-impact hide/show behavior
- `users.last_seen_at` (`TEXT`) — stamped on socket disconnect, used for the "Last seen" display
- `artisan_profiles.latitude`, `longitude` (`REAL`, nullable) — captured via the Geolocation API,
  never returned by any API response
- `artisan_profiles.service_radius_km` (`INTEGER`, nullable) — shown on the public profile

## Project structure

```
server/
  index.js              Express app + http.Server + socket.io (JWT-authed handshake, lead:<id>
                         rooms), SPA static serving
  db.js                  schema, ensureColumn migration helper, seed data
  presence.js             in-memory online-user tracking (connection counts, not a plain set)
  middleware/auth.js       JWT auth + role guard
  utils/ranking.js          ranking score calculation
  routes/
    auth.js                 register / login
    artisans.js              search, profile detail, portfolio CRUD + hide/show, location
    leads.js                  contact, messaging (emits to the lead's socket room), hire,
                               self-report, complete
    reviews.js                 review submission
    admin.js                    stats, flagged accounts, billing settings

client/
  src/
    api.js               fetch wrapper for the backend
    socket.js             socket.io-client connection helper
    App.jsx                 nav + page routing, socket connect/disconnect on auth
    hooks/useLeadThread.js   REST initial load + live socket updates for one lead's messages
    pages/                   Auth, Search, Profile, MyLeads, ArtisanDashboard, AdminDashboard
    components/
      Shared.jsx               reusable UI (work-order card, gauge, tags, modal)
      PortfolioManager.jsx      add/edit/hide-show portfolio items, score-impact confirm + banner
      LocationManager.jsx       city, service radius, Geolocation sharing
```

## Next steps toward production

- Swap SQLite for Postgres (schema is close to drop-in compatible)
- Radius-based search filtering using the captured `latitude`/`longitude`/`service_radius_km`
  (currently stored but not yet used to filter or sort search results)
- Real image upload for portfolio items and profile photos (currently text-only)
- Email/SMS for hire-confirmation follow-ups (currently manual, in-app only)
- Payment processing once a city/category segment is switched to `paid_mode`
- Rate limiting and input validation hardening for public deployment
