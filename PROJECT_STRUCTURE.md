# Project structure

A snapshot of the actual current layout, schema, and design tokens for NearHandsAT. This
describes what the code does today, not a roadmap.

## File tree

```
.gitignore                                node_modules/, *.db, dist/, .env
README.md                                 setup instructions, demo accounts, feature summary
package.json                              root build/start scripts for a single-service deploy (e.g. Railway)

client/
  index.html                              Vite entry HTML, loads Google Fonts + src/main.jsx
  package.json                            client dependencies + dev/build/preview scripts
  package-lock.json                       locked client dependency tree
  vite.config.js                          dev server port 5173, proxies /api and /socket.io to :4000
  src/
    main.jsx                              React root render, imports index.css
    index.css                             design tokens (CSS custom properties) + base styles
    api.js                                fetch wrapper for the REST API; holds/exposes the JWT
    socket.js                             socket.io-client connection helper (connect/disconnect)
    hooks/
      useLeadThread.js                    loads a lead's messages over REST, joins its socket room,
                                           appends live messages, falls back to REST refetch on send
                                           if the socket is disconnected
    components/
      Shared.jsx                          Tag, Gauge, WorkTag (search result card), Modal
      PortfolioManager.jsx                artisan's own portfolio: add/edit, hide/show with the
                                           confirm dialog + score-impact banner for job-linked items
    pages/
      Auth.jsx                            single login/register screen (role picked inline for
                                           register: client vs artisan)
      Search.jsx                          public search/filter list of artisans
      Profile.jsx                         one artisan's public profile + ContactFlow (message /
                                           hire modal, now live via useLeadThread)
      MyLeads.jsx                         client's view of their own leads: mark complete, review
      ArtisanDashboard.jsx                artisan's dashboard: stats, expandable request list with
                                           live thread + self-report, own reviews, portfolio manager
      AdminDashboard.jsx                  platform stats, flagged accounts, billing toggle per
                                           city/category

server/
  index.js                                Express app + http.Server + socket.io; JWT-auths the
                                           socket handshake; lead:<id> rooms; serves client/dist
                                           when present (SPA catch-all excluding /api/*)
  db.js                                   better-sqlite3 connection, schema (CREATE TABLE IF NOT
                                           EXISTS), ensureColumn migration helper, demo data seed
  package.json                            server dependencies + start/dev scripts
  package-lock.json                       locked server dependency tree
  middleware/
    auth.js                               requireAuth (JWT verify), requireRole, exports SECRET
  routes/
    auth.js                               POST /register, POST /login
    artisans.js                           search list, public profile detail, PUT /me (bio/city/
                                           trade), portfolio CRUD + hide/show for the owning artisan
    leads.js                              contact (creates lead + first message), /mine, message
                                           thread GET/POST (POST emits to the lead's socket room),
                                           hire, self-report, complete
    reviews.js                            POST a review (client, once per completed lead)
    admin.js                              stats, flagged-account detection, billing settings
  utils/
    ranking.js                            rankingScore()/conversionRatio() used by search + profile
```

## Auth & navigation flow (actual)

`App.jsx` gates the entire app on `user` state — there is no guest-browsing mode:

- **Signed out** → renders `Auth.jsx` only. This is a single component (not split into separate
  `RoleGate`/`AuthForm`/`FirstJobPrompt` components) with a Sign In / Create Account toggle. On
  register, the user picks `client` or `artisan` via two inline buttons; artisan registration adds
  trade + bio fields to the same form. There is no separate first-job or onboarding prompt step —
  submitting the form calls `POST /api/auth/register` or `/login` and immediately calls `onAuth`.
- **Signed in** → `onAuth` stores the user + JWT, connects the socket (`connectSocket()`), and
  picks a starting tab by role (`admin` → Admin, `artisan` → Dashboard, `client` → Search). The
  main shell is a top nav bar with role-scoped tabs (client: Find a Pro / Your Requests; artisan:
  Dashboard; admin: Admin) and a sign-out button that disconnects the socket and clears the token.

> Note: an earlier request for this document described the flow as `RoleGate → guest browsing or
> AuthForm signup → FirstJobPrompt for new artisans → main app shell`. None of those three
> component names exist anywhere in the codebase (checked directly) and there's no guest-browsing
> mode — the app requires sign-in/registration up front. The section above describes what `App.jsx`
> and `Auth.jsx` actually do.

## Database schema (from `server/db.js`)

Base tables, created with `CREATE TABLE IF NOT EXISTS`:

- **users** — `id` PK, `role` (`client`/`artisan`/`admin`), `name`, `email` (unique),
  `password_hash`, `city`, `created_at`
- **artisan_profiles** — `user_id` PK/FK → users, `trade`, `bio`, `city`, `avg_rating`,
  `review_count`, `jobs_completed`, `leads_received`
- **portfolio_items** — `id` PK, `artisan_id` FK → users, `label`, `note`, `created_at`
- **leads** — `id` PK, `client_id` FK → users, `artisan_id` FK → users, `status`
  (`contacted`/`hired`/`completed`/`not_hired`), `hire_source`, `created_at`, `hired_at`,
  `completed_at`
- **messages** — `id` PK, `lead_id` FK → leads, `sender_id` FK → users, `content`, `created_at`
- **reviews** — `id` PK, `lead_id` FK → leads, `client_id` FK → users, `artisan_id` FK → users,
  `rating` (1–5), `comment`, `created_at`
- **billing_settings** — `id` PK, `city`, `category`, `paid_mode`, `free_lead_limit`,
  `price_per_lead`, `subscription_price`, unique on `(city, category)`

Columns added at runtime via the `ensureColumn(table, column, definition)` helper (checks
`PRAGMA table_info` and runs `ALTER TABLE ... ADD COLUMN` only if missing, so it's safe to run
against an already-seeded database):

- **portfolio_items.hidden** — `INTEGER DEFAULT 0`. Cosmetic hide/show; excluded from the public
  profile when `1`.
- **portfolio_items.lead_id** — `INTEGER REFERENCES leads(id)`, nullable. Links a portfolio item
  to the specific confirmed job it represents, when there is one. Hiding a linked item also
  decrements `artisan_profiles.jobs_completed` (floored at 0); un-hiding re-increments it.

## Design tokens (`client/src/index.css`)

```css
--navy: #1E2A45;
--navy-light: #2E3E5F;
--chalk: #F1EFE7;
--card: #FBFAF6;
--amber: #E0912E;
--amber-dark: #B36F1C;
--green: #3F7857;
--green-bg: #EAF0EA;
--steel: #6B6F76;
--line: #DAD6C9;
--danger: #B33A2E;
```

Fonts (loaded from Google Fonts in `client/index.html`):

- **Display / headings** — `Oswald` (`.display` class), weights 500/600/700
- **Body** — `Inter` (default on `body`), weights 400/500/600
- **Monospace / numeric** — `IBM Plex Mono` (`.mono` class), weights 500/600

## Deferred / not yet built

- **Online/offline presence** — no presence tracking, `online` flag, or `last_seen_at` column
  exists yet.
- **Radius-based search filtering** — not implemented; search still filters on the free-text
  `city` field only.
- **Real image upload** — portfolio items and profiles are text-only (label/note/bio), no file
  upload or image storage.
- **Payment processing** — `billing_settings` exists (paid mode, price per lead, subscription
  price) but nothing charges a card; it's a toggle/config table only.

Real-time in-app chat (socket.io, live message delivery over `lead:<id>` rooms) **is** implemented
as of this snapshot — it is intentionally left out of the list above since it's no longer accurate
to call it deferred.
