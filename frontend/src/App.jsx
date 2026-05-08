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
    return { current: 0, returnPercent: 0, drawdownPercent: 0, investedPercent: 0 };
  }

  const first = Number(series[0].totalValue) || 0;
  const lastPoint = series[series.length - 1];
  const last = Number(lastPoint.totalValue) || 0;
  const holdingsValue = Number(lastPoint.holdingsValue) || 0;
  const peak = Math.max(...series.map((point) => Number(point.totalValue) || 0));

  return {
    current: last,
    returnPercent: first ? ((last - first) / first) * 100 : 0,
    drawdownPercent: peak ? ((last - peak) / peak) * 100 : 0,
    investedPercent: last ? ((Number(holdingsValue) || 0) / last) * 100 : 0,
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
  valueKey = "totalValue",
  benchmarkValueKey = "value",
  valueLabel = "Portfolio",
}) {
  const [hoverIndex, setHoverIndex] = useState(null);
  const width = 1120;
  const height = 420;
  const padding = 42;

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
  const minValue = allValues.length ? Math.min(...allValues) : 0;
  const maxValue = allValues.length ? Math.max(...allValues) : 1;
  const range = maxValue - minValue || 1;

  function toPoint(point, index, length, pointValueKey = valueKey) {
    const x = padding + (index / Math.max(length - 1, 1)) * (width - padding * 2);
    const y =
      height -
      padding -
      (((Number(point[pointValueKey]) || 0) - minValue) / range) * (height - padding * 2);
    return { ...point, x, y };
  }

  const chartPoints = series.map((point, index) => toPoint(point, index, series.length));
  const benchmarkPoints = activeBenchmarkSeries.map((benchmark) => ({
    ...benchmark,
    points: benchmark.series.map((point, index) =>
      toPoint(point, index, benchmark.series.length, benchmarkValueKey)
    ),
  }));
  const hoverPoint = hoverIndex === null ? null : chartPoints[hoverIndex];

  function handleMouseMove(event) {
    if (!chartPoints.length) {
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const index = Math.round(ratio * (chartPoints.length - 1));
    setHoverIndex(index);
  }

  function handleMouseLeave() {
    setHoverIndex(null);
  }

  return (
    <div className="chartShell">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="chartSvg"
        role="img"
        aria-label="Portfolio chart"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        {[0.25, 0.5, 0.75].map((ratio) => {
          const y = padding + (height - padding * 2) * ratio;
          const value = maxValue - range * ratio;
          return (
            <g key={ratio}>
              <line x1={padding} x2={width - padding} y1={y} y2={y} className="gridLine" />
              <text x={padding} y={y - 8} className="axisLabel">{formatPln(value)}</text>
            </g>
          );
        })}

        {benchmarkPoints.map((benchmark) => (
          <path
            key={benchmark.key}
            d={linePath(benchmark.points)}
            className="benchmarkLine"
            stroke={benchmark.color}
          />
        ))}

        <path d={linePath(chartPoints)} className="portfolioLine" />

        {events.map((event) => {
          const index = series.findIndex((point) => point.date === event.date);
          if (index < 0) {
            return null;
          }
          const point = chartPoints[index];
          return (
            <g key={event.key}>
              <line x1={point.x} x2={point.x} y1={padding} y2={height - padding} className="eventLine" />
              <circle cx={point.x} cy={point.y} r="5" className={`eventDot ${event.source}`} />
              <text x={clamp(point.x + 8, padding, width - 150)} y={clamp(point.y - 10, padding, height - padding)} className="eventLabel">
                {event.title}
              </text>
            </g>
          );
        })}

        {hoverPoint ? (
          <g>
            <line x1={hoverPoint.x} x2={hoverPoint.x} y1={padding} y2={height - padding} className="hoverLine" />
            <circle cx={hoverPoint.x} cy={hoverPoint.y} r="6" className="hoverDot" />
          </g>
        ) : null}
      </svg>

      {hoverPoint ? (
        <div className="chartTooltip">
          <strong>{formatDate(hoverPoint.date)}</strong>
          <span>{valueLabel} {formatPln(hoverPoint[valueKey])}</span>
          <span>Cash {formatPln(hoverPoint.cash)}</span>
          <span>Holdings {formatPln(hoverPoint.holdingsValue)}</span>
          {benchmarkPoints.map((benchmark) => {
            const point = benchmark.series.find((item) => item.date === hoverPoint.date);
            return point ? (
              <span key={benchmark.key} style={{ color: benchmark.color }}>
                {benchmark.label} {formatPln(point[benchmarkValueKey])}
              </span>
            ) : null;
          })}
        </div>
      ) : null}
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
          <small>{formatPercent(data?.summary?.currentProfitPercent || 0)} vs deposits</small>
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

              <BenchmarkToggles
                benchmarks={data.benchmarks}
                active={activeBenchmarks}
                onToggle={toggleBenchmark}
              />

              <PortfolioChart
                series={visibleSeries}
                benchmarks={visibleBenchmarks}
                activeBenchmarks={activeBenchmarks}
                events={visiblePortfolioEvents}
                valueKey="totalValue"
                benchmarkValueKey="value"
                valueLabel="Portfolio value"
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
              <PortfolioChart
                series={visibleSeries}
                benchmarks={visibleBenchmarks}
                activeBenchmarks={activeBenchmarks}
                events={visibleProfitEvents}
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
