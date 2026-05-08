import { useEffect, useMemo, useState } from "react";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";
const BENCHMARK_COLORS = {
  sp500: "#4fd1ff",
  nasdaq: "#b78cff",
  gold: "#ffd166",
  bitcoin: "#ff7a59",
};

function formatPln(value) {
  return new Intl.NumberFormat("pl-PL", {
    style: "currency",
    currency: "PLN",
    maximumFractionDigits: 2,
  }).format(value ?? 0);
}

function formatNumber(value, digits = 2) {
  return new Intl.NumberFormat("pl-PL", {
    maximumFractionDigits: digits,
  }).format(value ?? 0);
}

function formatPercent(value) {
  return new Intl.NumberFormat("pl-PL", {
    style: "percent",
    maximumFractionDigits: 1,
    signDisplay: "always",
  }).format((value ?? 0) / 100);
}

function formatDate(value) {
  if (!value) {
    return "";
  }

  return new Intl.DateTimeFormat("pl-PL", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function linePath(points) {
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(" ");
}

function filterByDate(series, startDate, endDate) {
  return series.filter((point) => {
    if (startDate && point.date < startDate) {
      return false;
    }
    if (endDate && point.date > endDate) {
      return false;
    }
    return true;
  });
}

function parseCustomEvents(input) {
  return input
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const [rawDate, ...labelParts] = line.split("|");
      const date = rawDate.trim();
      const label = labelParts.join("|").trim() || "Event";
      return /^\d{4}-\d{2}-\d{2}$/.test(date)
        ? { key: `custom-${index}-${date}`, date, title: label, source: "custom" }
        : null;
    })
    .filter(Boolean);
}

function buildPortfolioEvents(series) {
  if (!series.length) return [];
  const peak = series.reduce((best, point) =>
    Number(point.totalValue) > Number(best.totalValue) ? point : best
  );
  return [
    {
      key: "peak",
      date: peak.date,
      title: "Portfolio high",
      value: formatPln(peak.totalValue),
      source: "system",
    },
  ];
}

function buildProfitEvents(series) {
  if (!series.length) return [];
  
  const profitPeak = series.reduce((best, point) =>
    Number(point.profitValue) > Number(best.profitValue) ? point : best
  );
  const profitTrough = series.reduce((best, point) =>
    Number(point.profitValue) < Number(best.profitValue) ? point : best
  );

  let biggestProfitJump = null;
  let biggestProfitDrop = null;

  for (let index = 1; index < series.length; index += 1) {
    const previous = Number(series[index - 1].profitValue) || 0;
    const current = Number(series[index].profitValue) || 0;
    const change = current - previous;
    
    if (change > 0) {
      if (!biggestProfitJump || change > biggestProfitJump.change) {
        biggestProfitJump = { date: series[index].date, change };
      }
    } else if (change < 0) {
      if (!biggestProfitDrop || change < biggestProfitDrop.change) {
        biggestProfitDrop = { date: series[index].date, change };
      }
    }
  }

  return [
    {
      key: "profit-peak",
      date: profitPeak.date,
      title: "Profit high",
      value: formatPln(profitPeak.profitValue),
      source: "system",
    },
    {
      key: "profit-trough",
      date: profitTrough.date,
      title: "Profit low",
      value: formatPln(profitTrough.profitValue),
      source: "system",
    },
    biggestProfitJump
      ? {
          key: "profit-jump",
          date: biggestProfitJump.date,
          title: "Largest profit jump",
          value: formatPln(biggestProfitJump.change),
          source: "system",
        }
      : null,
    biggestProfitDrop
      ? {
          key: "profit-drop",
          date: biggestProfitDrop.date,
          title: "Largest profit drop",
          value: formatPln(biggestProfitDrop.change),
          source: "system",
        }
      : null,
  ].filter(Boolean);
}

function buildStats(series) {
  if (!series.length) {
    return { current: 0, returnPercent: 0, drawdownPercent: 0, investedPercent: 0, avgDepositProfitPercent: 0 };
  }

  const first = Number(series[0].totalValue) || 0;
  const lastPoint = series[series.length - 1];
  const last = Number(lastPoint.totalValue) || 0;
  const holdingsValue = Number(lastPoint.holdingsValue) || 0;
  const profitValue = Number(lastPoint.profitValue) || 0;
  const peak = Math.max(...series.map((point) => Number(point.totalValue) || 0));
  
  const avgDeposit = series.reduce((sum, p) => sum + (Number(p.externalCashFlow) || 0), 0) / series.length;
  const avgDepositProfitPercent = avgDeposit > 0 ? (profitValue / avgDeposit) * 100 : 0;

  return {
    current: last,
    returnPercent: first ? ((last - first) / first) * 100 : 0,
    drawdownPercent: peak ? ((last - peak) / peak) * 100 : 0,
    investedPercent: last ? ((Number(holdingsValue) || 0) / last) * 100 : 0,
    avgDepositProfitPercent,
  };
}

function RangeControls({ data, startDate, endDate, onStartDate, onEndDate }) {
  function setPreset(days) {
    if (!data?.summary) {
      return;
    }

    if (days === "all") {
      onStartDate(data.summary.startDate);
      onEndDate(data.summary.endDate);
      return;
    }

    const end = new Date(`${data.summary.endDate}T00:00:00`);
    const start = new Date(end);
    if (days === "ytd") {
      start.setMonth(0, 1);
    } else {
      start.setDate(start.getDate() - days);
    }

    onStartDate(start.toISOString().slice(0, 10));
    onEndDate(data.summary.endDate);
  }

  return (
    <div className="controlCluster">
      <div className="segmented">
        <button type="button" onClick={() => setPreset(30)}>1M</button>
        <button type="button" onClick={() => setPreset(90)}>3M</button>
        <button type="button" onClick={() => setPreset(180)}>6M</button>
        <button type="button" onClick={() => setPreset("ytd")}>YTD</button>
        <button type="button" onClick={() => setPreset(365)}>1Y</button>
        <button type="button" onClick={() => setPreset("all")}>ALL</button>
      </div>
      <div className="dateInputs">
        <label>
          <span>Start</span>
          <input type="date" value={startDate} onChange={(event) => onStartDate(event.target.value)} />
        </label>
        <label>
          <span>End</span>
          <input type="date" value={endDate} onChange={(event) => onEndDate(event.target.value)} />
        </label>
      </div>
    </div>
  );
}

function BenchmarkToggles({ benchmarks, active, onToggle }) {
  const entries = Object.entries(benchmarks ?? {});

  if (!entries.length) {
    return null;
  }

  return (
    <div className="benchmarkToggles">
      {entries.map(([key, benchmark]) => (
        <label key={key} className="togglePill">
          <input
            type="checkbox"
            checked={Boolean(active[key])}
            onChange={() => onToggle(key)}
          />
          <span style={{ "--dot": BENCHMARK_COLORS[key] ?? "#7cf6d2" }}>{benchmark.label}</span>
        </label>
      ))}
    </div>
  );
}

function PortfolioChart({
  series,
  benchmarks,
  activeBenchmarks,
  events,
  hoverIndex,
  onHover,
  valueKey = "totalValue",
  benchmarkValueKey = "value",
  valueLabel = "Portfolio",
  showZeroLine = true,
  startAtZero = false,
}) {
  const width = 1120;
  const height = 420;
  const padding = 50; // Increased padding for axes

  if (!series.length) {
    return <div className="chartEmpty">No data in selected range.</div>;
  }

  const activeBenchmarkSeries = Object.entries(benchmarks ?? {})
    .filter(([key]) => activeBenchmarks[key])
    .map(([key, benchmark]) => ({
      key,
      label: benchmark.label,
      color: BENCHMARK_COLORS[key] ?? "#7cf6d2",
      series: benchmark.series.filter((point) =>
        series.some((portfolioPoint) => portfolioPoint.date === point.date)
      ),
    }));

  const allValues = [
    ...series.map((point) => Number(point[valueKey]) || 0),
    ...activeBenchmarkSeries.flatMap((benchmark) =>
      benchmark.series.map((point) => Number(point[benchmarkValueKey]) || 0)
    ),
  ];
  const rawMin = allValues.length ? Math.min(...allValues) : 0;
  const rawMax = allValues.length ? Math.max(...allValues) : 1;
  const rawRange = rawMax - rawMin;
  const paddingVal = rawRange * 0.05 || 100;
  
  let floor = startAtZero ? 0 : Math.floor((rawMin - paddingVal) / 1000) * 1000;
  let ceil = Math.ceil((rawMax + paddingVal) / 1000) * 1000;
  let range = (ceil - floor) || 4000;
  
  // Adjust range to be multiple of 4000 for "nice" 25% steps
  if (range % 4000 !== 0) {
    range = Math.ceil(range / 4000) * 4000;
    ceil = floor + range;
  }

  function toPoint(point, index, length, pointValueKey = valueKey) {
    const x = padding + (index / Math.max(length - 1, 1)) * (width - padding * 2);
    const y =
      height -
      padding -
      (((Number(point[pointValueKey]) || 0) - floor) / range) * (height - padding * 2);
    return { ...point, x, y };
  }

  const chartPoints = series.map((point, index) => toPoint(point, index, series.length));
  const benchmarkPoints = activeBenchmarkSeries.map((benchmark) => ({
    ...benchmark,
    points: benchmark.series.map((point, index) =>
      toPoint(point, index, benchmark.series.length, benchmarkValueKey)
    ),
  }));
  const hoverPoint = hoverIndex !== null && hoverIndex >= 0 && hoverIndex < chartPoints.length ? chartPoints[hoverIndex] : null;

  function handleMouseMove(event) {
    if (!chartPoints.length) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const localX = (event.clientX - rect.left) * (width / rect.width);
    const ratio = clamp((localX - padding) / (width - padding * 2), 0, 1);
    const index = Math.round(ratio * (chartPoints.length - 1));
    onHover(index);
  }

  const zeroY = height - padding - ((0 - floor) / range) * (height - padding * 2);
  const reallyShowZeroLine = showZeroLine && floor < 0 && ceil > 0;

  return (
    <div className="chartShell">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="chartSvg"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => onHover(null)}
      >
        {/* Y Grid & Labels */}
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const y = height - padding - (height - padding * 2) * ratio;
          const val = floor + range * ratio;
          return (
            <g key={`y-${ratio}`}>
              <line x1={padding} x2={width - padding} y1={y} y2={y} stroke="rgba(255,255,255,0.1)" strokeDasharray="4 4" />
              <text x={padding - 10} y={y + 4} textAnchor="end" fill="#8da2b8" fontSize="10">{formatPln(val)}</text>
            </g>
          );
        })}

        {/* Zero Line */}
        {reallyShowZeroLine && (
          <g key="zero-line">
            <line
              x1={padding}
              x2={width - padding}
              y1={zeroY}
              y2={zeroY}
              stroke="#ff4d4d"
              strokeWidth="1.5"
              strokeDasharray="6 3"
              opacity="0.8"
            />
            <text
              x={padding - 10}
              y={zeroY + 4}
              textAnchor="end"
              fill="#ff4d4d"
              fontSize="11"
              fontWeight="bold"
            >
              0,00 zł
            </text>
          </g>
        )}

        {/* X Grid & Labels (Dates) */}
        {series.length > 1 && [0, 0.25, 0.5, 0.75, 1].map((ratio) => {
           const idx = Math.floor(ratio * (series.length - 1));
           const point = chartPoints[idx];
           return (
             <g key={`x-${ratio}`}>
               <line x1={point.x} x2={point.x} y1={padding} y2={height - padding} stroke="rgba(255,255,255,0.05)" />
               <text x={point.x} y={height - padding + 20} textAnchor="middle" fill="#8da2b8" fontSize="10">{formatDate(point.date)}</text>
             </g>
           );
        })}

        {/* Main Axes */}
        <line x1={padding} x2={padding} y1={padding} y2={height - padding} stroke="#25364c" />
        <line x1={padding} x2={width - padding} y1={height - padding} y2={height - padding} stroke="#25364c" />

        {benchmarkPoints.map((benchmark) => (
          <path key={benchmark.key} d={linePath(benchmark.points)} fill="none" stroke={benchmark.color} strokeWidth="1.5" opacity="0.6" />
        ))}

        <path d={linePath(chartPoints)} fill="none" stroke="#4fd1ff" strokeWidth="3" />

        {events.map((event) => {
          const idx = series.findIndex((p) => p.date === event.date);
          if (idx < 0) return null;
          const p = chartPoints[idx];
          return (
            <g key={event.key}>
              <line x1={p.x} x2={p.x} y1={padding} y2={height - padding} stroke="#ffd166" strokeDasharray="2 2" opacity="0.5" />
              <circle cx={p.x} cy={p.y} r="5" fill="#ffd166" stroke="#070b12" strokeWidth="2" />
              <rect x={p.x + 6} y={p.y - 20} width="80" height="16" rx="4" fill="rgba(7,11,18,0.8)" />
              <text x={p.x + 10} y={p.y - 8} fill="#ffd166" fontSize="9" fontWeight="bold">{event.title}</text>
            </g>
          );
        })}

        {hoverPoint && (
          <g>
            <line x1={hoverPoint.x} x2={hoverPoint.x} y1={padding} y2={height - padding} stroke="#4fd1ff" strokeDasharray="4 2" />
            <circle cx={hoverPoint.x} cy={hoverPoint.y} r="7" fill="#4fd1ff" stroke="#fff" strokeWidth="2" />
            <circle cx={hoverPoint.x} cy={hoverPoint.y} r="12" fill="#4fd1ff" opacity="0.2" />
          </g>
        )}
      </svg>
    </div>
  );
}

function LiveTooltip({ hoverPoint, benchmarks, visibleSeries, valueKey, valueLabel, activeBenchmarks }) {
  const displayPoint = hoverPoint || (visibleSeries && visibleSeries.length > 0 ? visibleSeries[visibleSeries.length - 1] : null);

  if (!displayPoint) {
    return <div className="liveTooltip placeholder">Waiting for portfolio data...</div>;
  }

  const activeBenchmarkSeries = Object.entries(benchmarks ?? {})
    .filter(([key]) => activeBenchmarks[key])
    .map(([key, benchmark]) => {
        const point = benchmark.series.find(p => p.date === displayPoint.date);
        return point ? { ...benchmark, current: point, key } : null;
    }).filter(Boolean);

  return (
    <div className={`liveTooltip ${hoverPoint ? "active" : "default"}`}>
      <div className="tipDate">
        <span>{hoverPoint ? formatDate(displayPoint.date) : "Latest: " + formatDate(displayPoint.date)}</span>
      </div>
      <div className="tipContent">
        <div className="tipGroup">
            <label>{valueLabel}</label>
            <strong>{formatPln(displayPoint[valueKey])}</strong>
        </div>
        <div className="tipGroup">
            <label>Cash</label>
            <strong>{formatPln(displayPoint.cash)}</strong>
        </div>
        <div className="tipGroup">
            <label>Holdings</label>
            <strong>{formatPln(displayPoint.holdingsValue)}</strong>
        </div>
      </div>
      <div className="tipBenchmarks">
        {activeBenchmarkSeries.length > 0 ? activeBenchmarkSeries.map(b => (
            <div key={b.key} className="tipBenchRow">
                <span className="dot" style={{ background: BENCHMARK_COLORS[b.key] }} />
                <span className="label">{b.label}</span>
                <strong>{formatPln(b.current.value)}</strong>
            </div>
        )) : <span className="noBenchmarks">Toggle benchmarks to compare</span>}
      </div>
    </div>
  );
}

function HoldingInsight({ holding }) {
  const insight = holding.insight ?? {};
  const recommendation = insight.recommendation
    ? insight.recommendation.replace("_", " ").toUpperCase()
    : "NO DATA";

  return (
    <article className="insightRow">
      <div>
        <strong>{holding.ticker}</strong>
        <span>{insight.name || holding.ticker}</span>
      </div>
      <div className="signalBadge">{recommendation}</div>
      <p>{insight.summary || "Brak danych analitycznych z Yahoo Finance."}</p>
      <div className="insightMeta">
        <span>{insight.sector || "sector n/a"}</span>
        <span>{insight.analystCount ? `${insight.analystCount} analysts` : "analysts n/a"}</span>
        <span>{insight.source || "source n/a"}</span>
        <span>{insight.asOf ? `as of ${insight.asOf}` : "date n/a"}</span>
        <span>
          {insight.targetMeanPrice
            ? `target ${formatNumber(insight.targetMeanPrice)} ${insight.targetCurrency || ""}`
            : "target n/a"}
        </span>
      </div>
    </article>
  );
}

export function App() {
  const [files, setFiles] = useState([]);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [customEventsText, setCustomEventsText] = useState("");
  const [activeBenchmarks, setActiveBenchmarks] = useState({ sp500: true, gold: true });
  const [hoverIndex, setHoverIndex] = useState(null);

  useEffect(() => {
    async function loadPortfolio() {
      setLoading(true);
      try {
        const response = await fetch(`${API_BASE}/api/portfolio`);
        if (response.ok) {
          const payload = await response.json();
          if (payload.series && payload.series.length > 0) {
            setData(payload);
            setStartDate(payload.summary.startDate);
            setEndDate(payload.summary.endDate);
          }
        }
      } catch (err) {
        console.error("Failed to load portfolio from DB", err);
      } finally {
        setLoading(false);
      }
    }
    loadPortfolio();
  }, []);

  const series = data?.series ?? [];
  const visibleSeries = useMemo(
    () => filterByDate(series, startDate, endDate),
    [series, startDate, endDate]
  );
  const visibleBenchmarks = useMemo(() => {
    const benchmarks = {};
    for (const [key, benchmark] of Object.entries(data?.benchmarks ?? {})) {
      benchmarks[key] = {
        ...benchmark,
        series: filterByDate(benchmark.series, startDate, endDate),
      };
    }
    return benchmarks;
  }, [data, startDate, endDate]);

  const portfolioEvents = useMemo(() => buildPortfolioEvents(visibleSeries), [visibleSeries]);
  const profitEvents = useMemo(() => buildProfitEvents(visibleSeries), [visibleSeries]);
  const customEvents = useMemo(() => parseCustomEvents(customEventsText), [customEventsText]);

  const visiblePortfolioEvents = useMemo(
    () =>
      [...portfolioEvents, ...customEvents].filter((event) =>
        visibleSeries.some((point) => point.date === event.date)
      ),
    [portfolioEvents, customEvents, visibleSeries]
  );

  const visibleProfitEvents = useMemo(
    () =>
      profitEvents.filter((event) =>
        visibleSeries.some((point) => point.date === event.date)
      ),
    [profitEvents, visibleSeries]
  );

  const stats = useMemo(
    () => buildStats(visibleSeries),
    [visibleSeries]
  );

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");

    if (!files.length) {
      setError("Dodaj przynajmniej jeden plik XLSX z XTB.");
      return;
    }

    const formData = new FormData();
    files.forEach((file) => formData.append("files", file));

    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/portfolio/analyze`, {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.detail || "Nie udalo sie przeliczyc portfela.");
      }
      const payload = await response.json();
      setData(payload);
      setStartDate(payload.summary.startDate);
      setEndDate(payload.summary.endDate);
    } catch (submitError) {
      setError(submitError.message || "Wystapil blad podczas wysylki.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  function toggleBenchmark(key) {
    setActiveBenchmarks((current) => ({ ...current, [key]: !current[key] }));
  }

  const hoverPoint = hoverIndex !== null ? visibleSeries[hoverIndex] : null;

  return (
    <main className="appShell">
      <header className="topBar">
        <div>
          <span className="brandMark">XTBX</span>
          <h1>Portfolio Command Center</h1>
        </div>
        <form className="uploadRail" onSubmit={handleSubmit}>
          <input
            type="file"
            accept=".xlsx"
            multiple
            onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
          />
          <button type="submit" disabled={loading}>{loading ? "Analyzing" : "Analyze"}</button>
        </form>
      </header>

      {error ? <div className="statusError">{error}</div> : null}

      <section className="commandGrid">
        <div className="metricPanel">
          <span>Portfolio value</span>
          <strong>{formatPln(stats.current || data?.summary?.currentTotalValue || 0)}</strong>
          <small>{visibleSeries.length ? `${formatDate(visibleSeries[0].date)} - ${formatDate(visibleSeries.at(-1).date)}` : "Upload XTB XLSX"}</small>
        </div>
        <div className="metricPanel">
          <span>Net deposits</span>
          <strong>{formatPln(data?.summary?.netExternalCashFlow || 0)}</strong>
          <small>cash paid into account</small>
        </div>
        <div className="metricPanel">
          <span>Total profit</span>
          <strong>{formatPln(data?.summary?.currentProfitValue || 0)}</strong>
          <small>
            {formatPercent(data?.summary?.currentProfitPercent || 0)} total | {formatPercent(stats.avgDepositProfitPercent)} avg eff
          </small>
        </div>
        <div className="metricPanel">
          <span>Market exposure</span>
          <strong>{formatPercent(stats.investedPercent)}</strong>
          <small>holdings / total</small>
        </div>
      </section>

      {data ? (
        <>
          <section className="workbench">
            <div className="chartPanel">
              <div className="panelHead">
                <div>
                  <span>Live range analysis</span>
                  <h2>Portfolio vs benchmark layer</h2>
                </div>
                <RangeControls
                  data={data}
                  startDate={startDate}
                  endDate={endDate}
                  onStartDate={setStartDate}
                  onEndDate={setEndDate}
                />
              </div>

              <div className="chartActionsRow">
                <BenchmarkToggles
                  benchmarks={data.benchmarks}
                  active={activeBenchmarks}
                  onToggle={toggleBenchmark}
                />
                <LiveTooltip 
                    hoverPoint={hoverPoint} 
                    benchmarks={data.benchmarks} 
                    visibleSeries={visibleSeries} 
                    valueKey="totalValue" 
                    valueLabel="Portfolio" 
                    activeBenchmarks={activeBenchmarks}
                />
              </div>

              <PortfolioChart
                series={visibleSeries}
                benchmarks={visibleBenchmarks}
                activeBenchmarks={activeBenchmarks}
                events={visiblePortfolioEvents}
                hoverIndex={hoverIndex}
                onHover={setHoverIndex}
                valueKey="totalValue"
                benchmarkValueKey="value"
                valueLabel="Portfolio value"
                showZeroLine={false}
                startAtZero={startDate === data?.summary?.startDate}
              />
            </div>

            <aside className="sidePanel">
              <div className="panelHead compact">
                <div>
                  <span>Event feed</span>
                  <h2>Portfolio milestones</h2>
                </div>
              </div>
              <textarea
                value={customEventsText}
                onChange={(event) => setCustomEventsText(event.target.value)}
                placeholder={"2024-02-01 | Fed decision\n2025-08-12 | Big rebalance"}
              />
              <div className="eventList">
                {visiblePortfolioEvents.length ? (
                  visiblePortfolioEvents.map((event) => (
                    <article key={event.key}>
                      <time>{formatDate(event.date)}</time>
                      <strong>{event.title}</strong>
                      {event.value ? <span>{event.value}</span> : null}
                    </article>
                  ))
                ) : (
                  <p>No events inside selected range.</p>
                )}
              </div>
            </aside>
          </section>

          <section className="workbench profitSection">
            <div className="chartPanel">
              <div className="panelHead compact">
                <div>
                  <span>Clean performance</span>
                  <h2>Profit curve (Zysk/Strata)</h2>
                </div>
              </div>
              
              <div className="chartActionsRow">
                <div /> {/* Spacer */}
                <LiveTooltip 
                    hoverPoint={hoverPoint} 
                    benchmarks={data.benchmarks} 
                    visibleSeries={visibleSeries} 
                    valueKey="profitValue" 
                    valueLabel="Profit/Loss" 
                    activeBenchmarks={activeBenchmarks}
                />
              </div>

              <PortfolioChart
                series={visibleSeries}
                benchmarks={visibleBenchmarks}
                activeBenchmarks={activeBenchmarks}
                events={visibleProfitEvents}
                hoverIndex={hoverIndex}
                onHover={setHoverIndex}
                valueKey="profitValue"
                benchmarkValueKey="profitValue"
                valueLabel="Profit/Loss"
              />
            </div>
            <aside className="sidePanel">
              <div className="panelHead compact">
                <div>
                  <span>Profit feed</span>
                  <h2>P/L Milestones</h2>
                </div>
              </div>
              <div className="eventList">
                {visibleProfitEvents.length ? (
                  visibleProfitEvents.map((event) => (
                    <article key={event.key}>
                      <time>{formatDate(event.date)}</time>
                      <strong>{event.title}</strong>
                      {event.value ? <span>{event.value}</span> : null}
                    </article>
                  ))
                ) : (
                  <p>No profit events inside range.</p>
                )}
              </div>
            </aside>
          </section>

          <section className="lowerGrid">
            <div className="dataPanel">
          <div className="panelHead compact">
            <div>
                  <span>Analyst consensus</span>
                  <h2>Freshest available signal</h2>
            </div>
          </div>
              <div className="insightList">
                {data.holdings.length ? (
                  data.holdings.map((holding) => <HoldingInsight key={holding.ticker} holding={holding} />)
                ) : (
                  <p className="emptyState">No open holdings.</p>
                )}
              </div>
            </div>

            <div className="dataPanel">
              <div className="panelHead compact">
                <div>
                  <span>Positions</span>
                  <h2>Open book</h2>
                </div>
              </div>
              <div className="tableWrap">
                <table>
                  <thead>
                    <tr>
                      <th>Ticker</th>
                      <th>Qty</th>
                      <th>Original price</th>
                      <th>Original value</th>
                      <th>Value PLN</th>
                      <th>Signal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.holdings.map((holding) => (
                      <tr key={holding.ticker}>
                        <td>{holding.ticker}</td>
                        <td>{formatNumber(holding.quantity, 6)}</td>
                        <td>{formatNumber(holding.priceOriginal, 4)} {holding.originalCurrency}</td>
                        <td>{formatNumber(holding.marketValueOriginal, 2)} {holding.originalCurrency}</td>
                        <td>{formatPln(holding.marketValuePln)}</td>
                        <td>{holding.insight?.recommendation?.replace("_", " ") ?? "n/a"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {data.warnings.length ? (
                <div className="warningStack">
                  {data.warnings.map((warning, index) => (
                    <p key={`${warning}-${index}`}>{warning}</p>
                  ))}
                </div>
              ) : null}
            </div>
          </section>
        </>
      ) : (
        <section className="emptyLanding">
          <strong>Upload XLSX to activate the terminal.</strong>
          <span>Chart hover, benchmark overlay, date zoom and consensus panels appear after analysis.</span>
        </section>
      )}
    </main>
  );
}
