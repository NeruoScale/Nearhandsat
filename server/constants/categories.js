// README roadmap #7A, Phase A: category taxonomy foundation.
//
// This is purely additive metadata layered on top of the existing trade
// strings -- it does NOT replace or migrate them. `code` is byte-for-byte
// identical to the existing TRADES entries (server/constants/trades.js),
// which are already stored as-is in artisan_profiles.trade, services.category,
// and billing_settings.category across both live databases. Those columns,
// and every query/filter/ranking/admin-stat/frontend piece that reads them,
// are untouched by this file. `code` is the stable identifier; name_en/fr/ar
// are display-only translations for future UI/candidate-matching use.
const { TRADES } = require("./trades");

const NAME_FR = {
  "Electrician": "Électricien",
  "Plumber": "Plombier",
  "Carpenter": "Menuisier",
  "Painter": "Peintre",
  "Mason": "Maçon",
  "Roofer": "Couvreur",
  "Tiler": "Carreleur",
  "Plasterer": "Plâtrier",
  "HVAC Technician": "Technicien CVC",
  "Welder": "Soudeur",
  "Locksmith": "Serrurier",
  "Gardener / Landscaper": "Jardinier / Paysagiste",
  "Cleaner": "Agent d'entretien",
  "Mover": "Déménageur",
  "Appliance Repair Technician": "Technicien en réparation d'électroménager",
  "Handyman": "Homme à tout faire",
  "Glazier": "Vitrier",
  "Flooring Installer": "Poseur de revêtements de sol",
  "Pool Maintenance": "Entretien de piscines",
  "Pest Control": "Lutte antiparasitaire",
  "Solar Panel Installer": "Installateur de panneaux solaires",
  "Blacksmith": "Forgeron",
  "Upholsterer": "Tapissier",
  "Auto Mechanic": "Mécanicien automobile",
  "Tailor": "Couturier",
};

const NAME_AR = {
  "Electrician": "كهربائي",
  "Plumber": "سباك",
  "Carpenter": "نجار",
  "Painter": "دهان",
  "Mason": "بنّاء",
  "Roofer": "عامل تسقيف",
  "Tiler": "عامل بلاط",
  "Plasterer": "جصّاص",
  "HVAC Technician": "فني تكييف وتدفئة",
  "Welder": "لحّام",
  "Locksmith": "صانع أقفال",
  "Gardener / Landscaper": "بستاني / منسق حدائق",
  "Cleaner": "عامل نظافة",
  "Mover": "عامل نقل أثاث",
  "Appliance Repair Technician": "فني إصلاح أجهزة منزلية",
  "Handyman": "عامل صيانة عامة",
  "Glazier": "زجّاج",
  "Flooring Installer": "فني تركيب الأرضيات",
  "Pool Maintenance": "صيانة المسابح",
  "Pest Control": "مكافحة الآفات",
  "Solar Panel Installer": "فني تركيب الألواح الشمسية",
  "Blacksmith": "حداد",
  "Upholsterer": "منجّد",
  "Auto Mechanic": "ميكانيكي سيارات",
  "Tailor": "خياط",
};

// code === the existing TRADES string, unchanged. parent_code is null for
// all 25 today (flat taxonomy) -- the column exists so a future phase can
// group categories (e.g. under a "Construction" parent) without a schema
// change.
const CATEGORIES = TRADES.map((code) => {
  const name_fr = NAME_FR[code];
  const name_ar = NAME_AR[code];
  if (!name_fr || !name_ar) {
    throw new Error(`server/constants/categories.js is missing a translation for trade "${code}"`);
  }
  return { code, name_en: code, name_fr, name_ar, parent_code: null };
});

module.exports = { CATEGORIES };
