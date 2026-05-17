import { formatPln, formatPercent, formatDate } from "../utils/format.js";

export function KpiStrip({ data, stats, visiblePortfolioSeries }) {
  return (
    <section className="commandGrid">
      <div className="metricPanel">
        <span>Portfolio value</span>
        <strong>{formatPln(stats.current || data?.summary?.currentTotalValue || 0)}</strong>
        <small>
          {visiblePortfolioSeries.length
            ? `${formatDate(visiblePortfolioSeries[0].date)} - ${formatDate(visiblePortfolioSeries.at(-1).date)}`
            : "Upload XTB XLSX"}
        </small>
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
  );
}
