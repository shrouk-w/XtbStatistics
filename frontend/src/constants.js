export const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";

export const BENCHMARK_COLORS = {
  wig20: "#0E6F4F",
  sp500: "#0F3D8C",
  nasdaq: "#7A4ED4",
  gold: "#B68A1F",
  bitcoin: "#C84E1D",
};

export const CHART_INK = "#0E0E10";
export const CHART_HAIR = "#E6E4DD";
export const CHART_MUTED = "#6B6B6E";
export const CHART_LOSS = "#B42318";
export const CHART_EVENT = "#B68A1F";

export const PAGES = [
  { id: "overview", label: "Overview" },
  { id: "performance", label: "Performance" },
  { id: "holdings", label: "Holdings" },
];
