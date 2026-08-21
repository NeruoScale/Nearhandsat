import React, { useEffect, useState } from "react";
import SearchableSelect from "./SearchableSelect";

// The country/state/city dataset is several MB uncompressed -- loaded via a
// dynamic import inside this component only, so it never lands in the main
// app bundle (guests browsing the app never download it).
export default function LocationPicker({ value, onChange }) {
  const [csc, setCsc] = useState(null);
  const [countries, setCountries] = useState([]);
  const [states, setStates] = useState([]);
  const [cities, setCities] = useState([]);
  const [stateSupported, setStateSupported] = useState(true);
  const [citySupported, setCitySupported] = useState(true);

  useEffect(() => {
    let cancelled = false;
    import("country-state-city").then((mod) => {
      if (!cancelled) setCsc(mod);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!csc) return;
    setCountries(csc.Country.getAllCountries());
  }, [csc]);

  useEffect(() => {
    if (!csc || !value.country) {
      setStates([]);
      setStateSupported(true);
      return;
    }
    const countryObj = csc.Country.getAllCountries().find((c) => c.name === value.country);
    if (!countryObj) {
      setStates([]);
      return;
    }
    const s = csc.State.getStatesOfCountry(countryObj.isoCode);
    setStates(s);
    setStateSupported(s.length > 0);
  }, [csc, value.country]);

  useEffect(() => {
    if (!csc || !value.country) {
      setCities([]);
      setCitySupported(true);
      return;
    }
    const countryObj = csc.Country.getAllCountries().find((c) => c.name === value.country);
    if (!countryObj) {
      setCities([]);
      return;
    }

    if (states.length > 0) {
      if (!value.state) {
        setCities([]);
        setCitySupported(true); // waiting on a state pick, not actually unsupported
        return;
      }
      const stateObj = states.find((s) => s.name === value.state);
      const c = stateObj ? csc.City.getCitiesOfState(countryObj.isoCode, stateObj.isoCode) : [];
      setCities(c);
      setCitySupported(c.length > 0);
    } else {
      // No state subdivisions for this country in the dataset -- some smaller
      // countries still have cities listed directly against the country.
      const c = csc.City.getCitiesOfCountry(countryObj.isoCode) || [];
      setCities(c);
      setCitySupported(c.length > 0);
    }
  }, [csc, value.country, value.state, states]);

  function set(key, v) {
    const next = { ...value, [key]: v };
    if (key === "country") {
      next.state = "";
      next.city = "";
    }
    if (key === "state") {
      next.city = "";
    }
    onChange(next);
  }

  if (!csc) {
    return <div className="input" style={{ color: "var(--steel)", fontSize: 13 }}>Loading locations…</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <SearchableSelect
        value={value.country || ""}
        onChange={(v) => set("country", v)}
        options={countries.map((c) => c.name)}
        placeholder="Country"
      />

      {stateSupported ? (
        <SearchableSelect
          value={value.state || ""}
          onChange={(v) => set("state", v)}
          options={states.map((s) => s.name)}
          placeholder="State / region"
          disabled={!value.country}
        />
      ) : (
        <input
          className="input"
          placeholder="State / region"
          value={value.state || ""}
          onChange={(e) => set("state", e.target.value)}
          disabled={!value.country}
        />
      )}

      {citySupported ? (
        <SearchableSelect
          value={value.city || ""}
          onChange={(v) => set("city", v)}
          options={cities.map((c) => c.name)}
          placeholder="City (type at least 2 letters)"
          minChars={2}
          maxResults={50}
          disabled={!value.country}
        />
      ) : (
        <input
          className="input"
          placeholder="City"
          value={value.city || ""}
          onChange={(e) => set("city", e.target.value)}
          disabled={!value.country}
        />
      )}
    </div>
  );
}
