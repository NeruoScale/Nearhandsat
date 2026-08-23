// Mirrors client/src/constants/trades.js exactly. Services need real
// server-side category validation (the first in this app -- artisan_profiles
// .trade itself has none, and stays that way; out of scope here), so this is
// a plain server-side copy of the same list rather than a shared package,
// consistent with this app's existing "no monorepo tooling" setup.
const TRADES = [
  "Electrician",
  "Plumber",
  "Carpenter",
  "Painter",
  "Mason",
  "Roofer",
  "Tiler",
  "Plasterer",
  "HVAC Technician",
  "Welder",
  "Locksmith",
  "Gardener / Landscaper",
  "Cleaner",
  "Mover",
  "Appliance Repair Technician",
  "Handyman",
  "Glazier",
  "Flooring Installer",
  "Pool Maintenance",
  "Pest Control",
  "Solar Panel Installer",
  "Blacksmith",
  "Upholsterer",
  "Auto Mechanic",
  "Tailor",
];

module.exports = { TRADES };
