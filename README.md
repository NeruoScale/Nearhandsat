# NearHandsAT

A marketplace connecting artisans & tradespeople ("AT") with clients — full-stack demo covering
profiles, search, in-app messaging, hire confirmation, reviews, a ranking algorithm, and an
admin dashboard with monetization controls.

## Stack

- **Backend**: Node.js + Express + SQLite (via `better-sqlite3` — a single-file database, no
  server setup needed). Swap in Postgres for production by changing `server/db.js`.
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
- **In-app messaging** — contact stays inside the app until a hire is confirmed
- **Hire confirmation flow** — client taps "I hired them"; this is both the billing signal and
  the ranking signal
- **Fallback self-report** — if a client never confirms, the artisan can self-report the outcome;
  flagged patterns (high leads, low confirmed-hire ratio) surface in the admin dashboard rather
  than being silently penalized
- **Reviews** — only unlockable after a lead reaches `completed` status, one per lead
- **Ranking algorithm** (`server/utils/ranking.js`) — weights rating + jobs done always; only
  factors in lead-to-hire conversion once an artisan has 10+ leads, so new profiles aren't
  punished for a small sample size
- **Admin dashboard** — platform totals, conversion by city/category, flagged accounts, and a
  per-city/per-category "paid mode" toggle with free-lead limits and pricing — off by default,
  matching the free-then-paid rollout plan

## Project structure

```
server/
  index.js              Express app entry
  db.js                 schema + seed data
  middleware/auth.js     JWT auth + role guard
  utils/ranking.js       ranking score calculation
  routes/
    auth.js               register / login
    artisans.js            search, profile detail, portfolio
    leads.js                contact, messaging, hire, self-report, complete
    reviews.js               review submission
    admin.js                  stats, flagged accounts, billing settings

client/
  src/
    api.js               fetch wrapper for the backend
    App.jsx               nav + page routing
    pages/                Auth, Search, Profile, MyLeads, ArtisanDashboard, AdminDashboard
    components/Shared.jsx  reusable UI (work-order card, gauge, tags, modal)
```

## Next steps toward production

- Swap SQLite for Postgres (schema is close to drop-in compatible)
- Real image upload for portfolio items and profile photos (currently text-only)
- Email/SMS for hire-confirmation follow-ups (currently manual, in-app only)
- Payment processing once a city/category segment is switched to `paid_mode`
- Rate limiting and input validation hardening for public deployment
