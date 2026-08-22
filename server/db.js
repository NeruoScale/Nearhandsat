// Database driver selector. Defaults to the existing SQLite implementation
// (server/db-sqlite.js) unchanged -- production stays on SQLite unless
// DB_DRIVER is explicitly set to "postgres" (it isn't, in Railway, as of
// this phase). Both backends export the same shape -- prepare(sql) ->
// { get(...params), all(...params), run(...params) } -- so every route
// file's query calls work unchanged against either one; only `await` was
// added at each call site, never the SQL text itself.
const driver = process.env.DB_DRIVER === "postgres" ? "postgres" : "sqlite";

if (driver === "postgres" && !process.env.DATABASE_URL) {
  // Fail loudly and immediately, not by silently falling back to SQLite --
  // an explicit request for Postgres with no way to reach it is a
  // configuration error, not a degraded-but-working state.
  throw new Error(
    "DB_DRIVER=postgres is set but DATABASE_URL is missing. Set DATABASE_URL, or unset DB_DRIVER to use SQLite."
  );
}

module.exports = driver === "postgres" ? require("./db-postgres") : require("./db-sqlite");
