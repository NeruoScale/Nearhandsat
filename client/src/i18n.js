import React, { createContext, useContext, useEffect, useState } from "react";

// Scope note: only Landing.jsx (and this language switcher) is translated/RTL-aware
// right now. AuthForm/Search/Profile/dashboards etc. stay English-only for this pass --
// translating the rest of the app is a follow-up, not attempted here.
const STORAGE_KEY = "nh_lang";

export const translations = {
  en: {
    langName: "EN",
    hero: {
      title: "NEARHANDS",
      titleAccent: "AT",
      tagline: "Skilled hands, near you.",
      headline: "Find a trusted pro for any job, or get found by clients near you.",
      subhead:
        "Find trusted, local professionals for any job — or get discovered by clients looking for exactly what you do.",
    },
    howItWorks: {
      title: "How it works",
      clientTab: "For clients",
      proTab: "For professionals",
      clientSteps: [
        "Search by trade and city",
        "Check real reviews and past work",
        "Message them directly in the app",
        "Hire with confidence",
      ],
      proSteps: [
        "Create your free profile",
        "Add your past work",
        "Get discovered by nearby clients",
        "Grow your reputation with real reviews",
      ],
    },
    trustLine: "Free to browse. Free to list. No hidden fees while we're getting started.",
    cta: {
      client: "I need work done",
      professional: "I'm a professional",
    },
    signIn: "Sign in",
  },
  fr: {
    langName: "FR",
    hero: {
      title: "NEARHANDS",
      titleAccent: "AT",
      tagline: "Des mains habiles, près de chez vous.",
      headline:
        "Trouvez un professionnel de confiance pour tous vos travaux, ou faites-vous connaître auprès des clients près de chez vous.",
      subhead:
        "Trouvez des professionnels locaux et fiables pour tous vos travaux — ou faites-vous découvrir par des clients qui cherchent exactement vos services.",
    },
    howItWorks: {
      title: "Comment ça marche",
      clientTab: "Pour les clients",
      proTab: "Pour les professionnels",
      clientSteps: [
        "Recherchez par métier et ville",
        "Consultez les avis et travaux réalisés",
        "Contactez-les directement dans l'application",
        "Engagez en toute confiance",
      ],
      proSteps: [
        "Créez votre profil gratuitement",
        "Ajoutez vos réalisations",
        "Soyez découvert par des clients proches",
        "Développez votre réputation grâce à de vrais avis",
      ],
    },
    trustLine: "Gratuit pour parcourir. Gratuit pour s'inscrire. Aucun frais caché pour le moment.",
    cta: {
      client: "J'ai besoin d'un service",
      professional: "Je suis un professionnel",
    },
    signIn: "Se connecter",
  },
  ar: {
    langName: "AR",
    hero: {
      title: "NEARHANDS",
      titleAccent: "AT",
      tagline: "أيادٍ ماهرة، بالقرب منك.",
      headline: "اعثر على محترف موثوق لأي عمل، أو اجعل العملاء القريبين يجدونك.",
      subhead: "اعثر على محترفين محليين وموثوقين لأي عمل — أو اجعل العملاء يكتشفون خدماتك بسهولة.",
    },
    howItWorks: {
      title: "كيف يعمل",
      clientTab: "للعملاء",
      proTab: "للمحترفين",
      clientSteps: [
        "ابحث حسب المهنة والمدينة",
        "اطّلع على التقييمات والأعمال السابقة",
        "تواصل معهم مباشرة داخل التطبيق",
        "استعن بهم بثقة",
      ],
      proSteps: [
        "أنشئ ملفك الشخصي مجانًا",
        "أضف أعمالك السابقة",
        "اجعل العملاء القريبين يكتشفونك",
        "عزّز سمعتك من خلال تقييمات حقيقية",
      ],
    },
    trustLine: "التصفح مجاني. التسجيل مجاني. لا رسوم خفية في الوقت الحالي.",
    cta: {
      client: "أحتاج إلى خدمة",
      professional: "أنا محترف",
    },
    signIn: "تسجيل الدخول",
  },
};

const LanguageContext = createContext(null);

export function LanguageProvider({ children }) {
  const [lang, setLang] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored && translations[stored] ? stored : "en";
    } catch {
      return "en";
    }
  });

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // localStorage unavailable (private mode, etc.) -- language choice just won't persist
    }
  }, [lang]);

  // Plain React.createElement here (not JSX) since this file is .js, not .jsx --
  // Vite's default esbuild config only parses JSX syntax in .jsx/.tsx files.
  return React.createElement(LanguageContext.Provider, { value: { lang, setLang, t: translations[lang] } }, children);
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLanguage must be used within a LanguageProvider");
  return ctx;
}
