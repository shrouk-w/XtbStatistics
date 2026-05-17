import { useEffect, useState } from "react";

import { Topbar } from "./components/Topbar.jsx";
import { BootLoading } from "./components/BootLoading.jsx";
import { HeroEmpty } from "./components/HeroEmpty.jsx";
import { ErrorBanner } from "./components/ErrorBanner.jsx";
import { ManualEntry } from "./components/ManualEntry.jsx";

import { OverviewPage } from "./pages/OverviewPage.jsx";
import { PerformancePage } from "./pages/PerformancePage.jsx";
import { HoldingsPage } from "./pages/HoldingsPage.jsx";

import { getPortfolio, analyzeUpload, addManualOperation } from "./api.js";
import { PAGES } from "./constants.js";

const CACHE_KEY = "xtb_portfolio_cache_v1";
const CACHE_MAX_AGE = 1000 * 60 * 60; // 1 hour — show stale, refresh in background

function readPageFromHash() {
  const target = window.location.hash.replace(/^#\/?/, "") || "overview";
  return PAGES.some((p) => p.id === target) ? target : "overview";
}

function readCachedPortfolio() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { value, savedAt } = JSON.parse(raw);
    if (!value || !value.series || value.series.length === 0) return null;
    if (Date.now() - savedAt > CACHE_MAX_AGE) return null;
    return value;
  } catch {
    return null;
  }
}

function writeCachedPortfolio(value) {
  try {
    if (value && value.series && value.series.length > 0) {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ value, savedAt: Date.now() }));
    }
  } catch {
    // ignore quota / private mode failures
  }
}

export function App() {
  const cached = readCachedPortfolio();
  const [data, setData] = useState(cached);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(!cached);

  const [files, setFiles] = useState([]);
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [customEvents, setCustomEvents] = useState([]);
  const [page, setPage] = useState(readPageFromHash);

  // Manual entry form state (lives at App-level so the drawer can open from any page)
  const [manualDate, setManualDate] = useState(new Date().toISOString().slice(0, 10));
  const [manualType, setManualType] = useState("Stock purchase");
  const [manualSymbol, setManualSymbol] = useState("");
  const [manualAmount, setManualAmount] = useState("");
  const [manualPrice, setManualPrice] = useState("");
  const [manualComment, setManualComment] = useState("");

  // Initial load + hash routing
  useEffect(() => {
    async function loadInitial() {
      setLoading(true);
      try {
        const payload = await getPortfolio();
        if (payload?.series && payload.series.length > 0) {
          setData(payload);
          writeCachedPortfolio(payload);
        } else {
          // server returned empty — clear stale cache
          localStorage.removeItem(CACHE_KEY);
          setData(null);
        }
      } catch (err) {
        console.error("Failed to load portfolio from DB", err);
      } finally {
        setLoading(false);
        setBootstrapping(false);
      }
    }
    loadInitial();

    function onHash() { setPage(readPageFromHash()); }
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  function navigate(target) {
    window.location.hash = `/${target}`;
    setPage(target);
  }

  async function handleSubmit(event, persist = true) {
    if (event) event.preventDefault();
    setError("");

    if (!files.length) {
      setError("Add at least one XTB XLSX file.");
      return;
    }

    setLoading(true);
    try {
      const payload = await analyzeUpload(files, persist);
      setData(payload);
      writeCachedPortfolio(payload);
      if (persist) setFiles([]);
    } catch (err) {
      setError(err.message || "Analyze failed.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  async function handleManualSync(event) {
    event.preventDefault();
    setError("");

    const qty = parseFloat(manualAmount) || 0;
    const price = parseFloat(manualPrice) || 0;

    let finalAmount = 0;
    if (manualType.includes("Stock")) {
      finalAmount = qty * price;
    } else {
      finalAmount = qty;
    }

    const payload = {
      time: manualDate,
      operation_type: manualType,
      symbol: manualSymbol || null,
      amount: finalAmount,
      comment: manualType.includes("Stock")
        ? `Qty: ${qty}, Price: ${price} | ${manualComment}`
        : manualComment,
    };

    setLoading(true);
    try {
      await addManualOperation(payload);
      const fresh = await getPortfolio();
      if (fresh?.series && fresh.series.length > 0) {
        setData(fresh);
        writeCachedPortfolio(fresh);
      }
      setManualAmount("");
      setManualPrice("");
      setManualSymbol("");
      setManualComment("");
      setShowManualEntry(false);
    } catch (err) {
      setError(err.message || "Manual sync failed.");
    } finally {
      setLoading(false);
    }
  }

  function renderBody() {
    if (bootstrapping) return <BootLoading />;
    if (!data) {
      return (
        <HeroEmpty
          files={files}
          setFiles={setFiles}
          loading={loading}
          onSubmit={handleSubmit}
        />
      );
    }

    if (page === "performance") {
      return (
        <PerformancePage
          data={data}
          customEvents={customEvents}
          setCustomEvents={setCustomEvents}
        />
      );
    }
    if (page === "holdings") {
      return <HoldingsPage data={data} />;
    }
    return (
      <OverviewPage
        data={data}
        customEvents={customEvents}
        setCustomEvents={setCustomEvents}
        onError={setError}
      />
    );
  }

  return (
    <main className="appShell">
      <Topbar
        data={data}
        page={page}
        navigate={navigate}
        showManualEntry={showManualEntry}
        toggleManualEntry={() => setShowManualEntry((v) => !v)}
        files={files}
        setFiles={setFiles}
        loading={loading}
        onResync={handleSubmit}
      />

      <ErrorBanner message={error} onDismiss={() => setError("")} />

      {data?.warnings?.some((warning) => warning.startsWith("STOOQ_API_ERROR")) ? (
        <div className="statusError apiWarning">
          {data.warnings
            .find((warning) => warning.startsWith("STOOQ_API_ERROR"))
            .replace("STOOQ_API_ERROR: ", "")}
          <small>Sprawdz README.md, aby dowiedziec sie jak odswiezyc klucz.</small>
        </div>
      ) : null}

      {data && showManualEntry ? (
        <ManualEntry
          manualType={manualType} setManualType={setManualType}
          manualDate={manualDate} setManualDate={setManualDate}
          manualSymbol={manualSymbol} setManualSymbol={setManualSymbol}
          manualAmount={manualAmount} setManualAmount={setManualAmount}
          manualPrice={manualPrice} setManualPrice={setManualPrice}
          manualComment={manualComment} setManualComment={setManualComment}
          loading={loading}
          onSubmit={handleManualSync}
          onClose={() => setShowManualEntry(false)}
        />
      ) : null}

      {renderBody()}
    </main>
  );
}
