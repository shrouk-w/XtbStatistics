import { API_BASE } from "./constants.js";

export async function getPortfolio() {
  const res = await fetch(`${API_BASE}/api/portfolio`);
  if (!res.ok) throw new Error("Failed to load portfolio.");
  return res.json();
}

export async function analyzeUpload(files, persist = true) {
  const formData = new FormData();
  files.forEach((f) => formData.append("files", f));
  formData.append("persist", persist);

  const res = await fetch(`${API_BASE}/api/portfolio/analyze`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(payload.detail || "Could not analyze portfolio.");
  }
  return res.json();
}

export async function addManualOperation(payload) {
  const res = await fetch(`${API_BASE}/api/portfolio/manual`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("Manual operation failed.");
  return res.json();
}
