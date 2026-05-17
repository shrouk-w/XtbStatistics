import { formatNumber } from "../utils/format.js";

export function HoldingInsight({ holding }) {
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
