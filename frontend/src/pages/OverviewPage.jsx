import { useMemo, useState } from "react";
import { KpiStrip } from "../components/KpiStrip.jsx";
import { RangeControls } from "../components/RangeControls.jsx";
import { BenchmarkToggles } from "../components/BenchmarkToggles.jsx";
import { LiveTooltip } from "../components/LiveTooltip.jsx";
import { PortfolioChart } from "../components/PortfolioChart.jsx";
import { EventFeed } from "../components/EventFeed.jsx";
import { filterByDate, buildPortfolioEvents, buildStats } from "../utils/portfolio.js";

export function OverviewPage({ data, customEvents, setCustomEvents, onError }) {
  const [start, setStart] = useState(data.summary.startDate);
  const [end, setEnd] = useState(data.summary.endDate);
  const [activeBenchmarks, setActiveBenchmarks] = useState({ sp500: true, gold: true });
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
    () => buildPortfolioEvents(visibleSeries, customEvents),
    [visibleSeries, customEvents]
  );
  const visibleEvents = useMemo(
    () => events.filter((event) => visibleSeries.some((p) => p.date === event.date)),
    [events, visibleSeries]
  );
  const stats = useMemo(() => buildStats(visibleSeries), [visibleSeries]);

  const hoverPoint = hover !== null ? visibleSeries[hover] : null;

  return (
    <>
      <KpiStrip data={data} stats={stats} visiblePortfolioSeries={visibleSeries} />

      <section className="workbench">
        <div className="chartPanel">
          <div className="panelHead">
            <div>
              <span>Live range analysis</span>
              <h2>Portfolio vs benchmark layer</h2>
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
              valueKey="totalValue"
              valueLabel="Portfolio"
              activeBenchmarks={activeBenchmarks}
              benchmarkValueKey="value"
            />
          </div>

          <PortfolioChart
            series={visibleSeries}
            benchmarks={visibleBenchmarks}
            activeBenchmarks={activeBenchmarks}
            events={visibleEvents}
            hoverIndex={hover}
            onHover={setHover}
            valueKey="totalValue"
            benchmarkValueKey="value"
            showZeroLine={false}
            startAtZero={start === data?.summary?.startDate}
          />
        </div>

        <EventFeed
          eyebrow="Event feed"
          title="Portfolio milestones"
          events={visibleEvents}
          emptyText="No events inside selected range."
          customEvents={customEvents}
          setCustomEvents={setCustomEvents}
          onError={onError}
          withAddBox
        />
      </section>
    </>
  );
}
