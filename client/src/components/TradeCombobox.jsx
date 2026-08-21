import React from "react";
import { TRADES } from "../constants/trades";
import SearchableSelect from "./SearchableSelect";

export default function TradeCombobox({ value, onChange, placeholder }) {
  return <SearchableSelect value={value} onChange={onChange} options={TRADES} placeholder={placeholder} />;
}
