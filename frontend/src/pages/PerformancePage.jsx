import { useMemo, useState } from "react";
import { RangeControls } from "../components/RangeControls.jsx";
import { BenchmarkToggles } from "../components/BenchmarkToggles.jsx";
import { LiveTooltip } from "../components/LiveTooltip.jsx";
import { PortfolioChart } from "../components/PortfolioChart.jsx";
import { EventFeed } from "../components/EventFeed.jsx";
import { filterByDate, buildProfitEvents } from "../utils/portfolio.js";

export function PerformancePage({ data, customEvents, setCustomEvents }) {
  const [start, setStart] = useState(data.summary.startDate);
  const [end, setEnd] = useState(data.summary.endDate);
  const [activeBenchmarks, setActiveBenchmarks] = useState({ sp500: false, gold: false });
  const [hover, setHover] = useState(null);

  const series = data?.series ?? [];

  const visibleSeries = useMemo(
    () => filterByDate(series, start, end),
    [series, start, end]
  );
  const visibleBenchmarks = useMemo(() => {
    const result = {};
    for (const [key, benchmark] of Object.entries(data?.benchmarks ?? {})) {
      result[key] = { ...benchmark, series: filterByDate(benchmark.series, start, end) };
    }
    return result;
  }, [data, start, end]);

  const events = useMemo(
    () => buildProfitEvents(visibleSeries, customEvents),
    [visibleSeries, customEvents]
  );
  const visibleEvents = useMemo(
    () => events.filter((event) => visibleSeries.some((p) => p.date === event.date)),
    [events, visibleSeries]
  );

  const hoverPoint = hover !== null ? visibleSeries[hover] : null;

  return (
    <section className="workbench profitSection">
      <div className="chartPanel">
        <div className="panelHead compact">
          <div>
            <span>Clean performance</span>
            <h2>Profit curve (Zysk/Strata)</h2>
          </div>
          <RangeControls
            data={data}
            startDate={start}
            endDate={end}
            onStartDate={setStart}
            onEndDate={setEnd}
          />
        </div>

        <div className="chartActionsRow">
          <BenchmarkToggles
            benchmarks={data.benchmarks}
            active={activeBenchmarks}
            onToggle={(key) =>
              setActiveBenchmarks((curr) => ({ ...curr, [key]: !curr[key] }))
            }
          />
          <LiveTooltip
            hoverPoint={hoverPoint}
            benchmarks={data.benchmarks}
            visibleSeries={visibleSeries}
            valueKey="profitValue"
            valueLabel="Profit/Loss"
            activeBenchmarks={activeBenchmarks}
            benchmarkValueKey="profitValue"
          />
        </div>

        <PortfolioChart
          series={visibleSeries}
          benchmarks={visibleBenchmarks}
          activeBenchmarks={activeBenchmarks}
          events={visibleEvents}
          hoverIndex={hover}
          onHover={setHover}
          valueKey="profitValue"
          benchmarkValueKey="profitValue"
        />
      </div>

      <EventFeed
        eyebrow="Profit feed"
        title="P/L Milestones"
        events={visibleEvents}
        emptyText="No profit events inside range."
        customEvents={customEvents}
        setCustomEvents={setCustomEvents}
      />
    </section>
  );
}
