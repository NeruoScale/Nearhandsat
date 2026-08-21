// Ranking score used to order search results.
// Weighs rating and completed jobs always; only weighs lead-to-hire
// conversion once an artisan has received enough leads for the ratio
// to be meaningful (avoids punishing brand-new profiles).
const MIN_LEADS_FOR_CONVERSION = 10;

function conversionRatio(profile) {
  if (profile.leads_received < MIN_LEADS_FOR_CONVERSION) return null;
  return profile.jobs_completed / profile.leads_received;
}

function rankingScore(profile) {
  const ratingScore = (profile.avg_rating || 0) * 20; // 0-100
  const jobsScore = Math.min(profile.jobs_completed, 60); // 0-60
  const ratio = conversionRatio(profile);
  const conversionScore = ratio === null ? 15 : ratio * 40; // neutral default for new profiles
  return Math.round(ratingScore + jobsScore + conversionScore);
}

module.exports = { rankingScore, conversionRatio, MIN_LEADS_FOR_CONVERSION };
