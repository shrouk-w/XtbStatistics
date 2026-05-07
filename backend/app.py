from __future__ import annotations

import io
import math
import mimetypes
import os
import re
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

import pandas as pd
import httpx
import yfinance as yf
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from openpyxl import load_workbook


COMMENT_RE = re.compile(
    r"(?:OPEN|CLOSE) BUY (?P<quantity>\d+(?:\.\d+)?)(?:/(?P<total>\d+(?:\.\d+)?))? @ (?P<price>\d+(?:\.\d+)?)"
)
YAHOO_SUFFIX_MAP = {
    ".PL": ".WA",
    ".US": "",
    ".UK": ".L",
    ".FR": ".PA",
    ".NL": ".AS",
}
CURRENCY_SUFFIX_FALLBACK = {
    ".WA": "PLN",
    ".DE": "EUR",
    ".FR": "EUR",
    ".NL": "EUR",
    ".PA": "EUR",
    ".MI": "EUR",
    ".AS": "EUR",
    ".BR": "EUR",
    ".L": "GBP",
    ".LON": "GBP",
    ".UK": "GBP",
}
FX_SYMBOLS = {
    "EUR": "EURPLN=X",
    "USD": "USDPLN=X",
    "GBP": "GBPPLN=X",
    "PLN": None,
}
PROXY_ENV_NAMES = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]
BENCHMARKS = {
    "sp500": {"symbol": "^GSPC", "label": "S&P 500"},
    "nasdaq": {"symbol": "^IXIC", "label": "Nasdaq Composite"},
    "gold": {"symbol": "GC=F", "label": "Gold futures"},
    "bitcoin": {"symbol": "BTC-USD", "label": "Bitcoin"},
}

# Windows can resolve .js as text/plain from registry, which breaks ES modules in browsers.
mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("application/javascript", ".mjs")


@dataclass
class PositionEvent:
    ticker: str
    yahoo_ticker: str
    quantity_delta: float
    trade_date: date


@dataclass
class CashEvent:
    event_date: date
    amount: float
    operation_type: str


def create_app() -> FastAPI:
    app = FastAPI(title="XTB Portfolio History")
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/api/portfolio/analyze")
    async def analyze_portfolio(files: list[UploadFile] = File(...)) -> dict[str, Any]:
        if not files:
            raise HTTPException(status_code=400, detail="No files uploaded.")

        cash_events: list[CashEvent] = []
        external_cash_events: list[tuple[date, float]] = []
        trade_cash_events: list[tuple[date, float]] = []
        position_events: list[PositionEvent] = []
        warnings: list[str] = []

        for upload in files:
            filename = upload.filename or "uploaded.xlsx"
            if not filename.lower().endswith(".xlsx"):
                warnings.append(f"Skipped unsupported file: {filename}")
                continue

            payload = await upload.read()
            parsed = parse_xtb_workbook(payload, filename)
            cash_events.extend(parsed["cash_events"])
            external_cash_events.extend(parsed["external_cash_events"])
            trade_cash_events.extend(parsed["trade_cash_events"])
            position_events.extend(parsed["position_events"])
            warnings.extend(parsed["warnings"])

        if not cash_events and not position_events:
            raise HTTPException(status_code=400, detail="No XTB transactions found in uploaded files.")

        portfolio = build_portfolio_history(cash_events, external_cash_events, trade_cash_events, position_events)
        portfolio["warnings"].extend(warnings)
        return portfolio

    frontend_dist = Path(__file__).resolve().parent.parent / "frontend" / "dist"
    if frontend_dist.exists():
        app.mount("/assets", StaticFiles(directory=frontend_dist / "assets"), name="assets")

        @app.get("/")
        def index() -> FileResponse:
            return FileResponse(frontend_dist / "index.html")

    return app


def parse_xtb_workbook(payload: bytes, filename: str) -> dict[str, Any]:
    workbook = load_workbook(io.BytesIO(payload), data_only=True)
    cash_events: list[CashEvent] = []
    external_cash_events: list[tuple[date, float]] = []
    trade_cash_events: list[tuple[date, float]] = []
    position_events: list[PositionEvent] = []
    warnings: list[str] = []

    if "Cash Operations" not in workbook.sheetnames:
        warnings.append(f"{filename}: missing 'Cash Operations' sheet.")
        return {
            "cash_events": cash_events,
            "external_cash_events": external_cash_events,
            "trade_cash_events": trade_cash_events,
            "position_events": position_events,
            "warnings": warnings,
        }

    sheet = workbook["Cash Operations"]
    for row in sheet.iter_rows(min_row=6, values_only=True):
        if not row or not row[0]:
            continue

        operation_type = str(row[0]).strip()
        xtb_ticker = (row[1] or "").strip()
        event_time = row[3]
        amount = row[4]
        comment = (row[6] or "").strip()

        if not isinstance(event_time, datetime) or amount is None:
            continue

        event_date = event_time.date()
        cash_amount = float(amount)
        cash_events.append(CashEvent(event_date=event_date, amount=cash_amount, operation_type=operation_type))

        if operation_type in {"Stock purchase", "Stock sell"}:
            trade_cash_events.append((event_date, cash_amount))
        elif is_external_cash_operation(operation_type):
            external_cash_events.append((event_date, cash_amount))

        if operation_type == "Stock purchase":
            quantity = extract_quantity(comment)
            if quantity is None:
                warnings.append(f"{filename}: could not parse quantity from comment '{comment}'.")
                continue
            position_events.append(
                PositionEvent(
                    ticker=xtb_ticker,
                    yahoo_ticker=to_yahoo_symbol(xtb_ticker),
                    quantity_delta=quantity,
                    trade_date=event_date,
                )
            )
        elif operation_type == "Stock sell":
            quantity = extract_quantity(comment)
            if quantity is None:
                warnings.append(f"{filename}: could not parse quantity from comment '{comment}'.")
                continue
            position_events.append(
                PositionEvent(
                    ticker=xtb_ticker,
                    yahoo_ticker=to_yahoo_symbol(xtb_ticker),
                    quantity_delta=-quantity,
                    trade_date=event_date,
                )
            )

    return {
        "cash_events": cash_events,
        "external_cash_events": external_cash_events,
        "trade_cash_events": trade_cash_events,
        "position_events": position_events,
        "warnings": warnings,
    }


def is_external_cash_operation(operation_type: str) -> bool:
    normalized = operation_type.lower()
    return any(keyword in normalized for keyword in ["deposit", "withdrawal", "transfer"])


def to_yahoo_symbol(xtb_ticker: str) -> str:
    for suffix, replacement in YAHOO_SUFFIX_MAP.items():
        if xtb_ticker.endswith(suffix):
            return xtb_ticker[: -len(suffix)] + replacement
    return xtb_ticker


def extract_quantity(comment: str) -> float | None:
    match = COMMENT_RE.search(comment)
    if not match:
        return None
    return float(match.group("quantity"))


def build_portfolio_history(
    cash_events: list[CashEvent],
    external_cash_events: list[tuple[date, float]],
    trade_cash_events: list[tuple[date, float]],
    position_events: list[PositionEvent],
) -> dict[str, Any]:
    all_dates = [event.event_date for event in cash_events] + [event.trade_date for event in position_events]
    start_date = min(all_dates)
    end_date = date.today()
    index = pd.date_range(start=start_date, end=end_date, freq="D")

    cash_series = pd.Series(0.0, index=index)
    for event in cash_events:
        cash_series.loc[pd.Timestamp(event.event_date)] += float(event.amount)
    cash_series = cash_series.cumsum()

    external_cash_series = pd.Series(0.0, index=index)
    for event_date, amount in external_cash_events:
        external_cash_series.loc[pd.Timestamp(event_date)] += float(amount)
    external_cash_series = external_cash_series.cumsum()

    if position_events:
        quantities_df = build_quantities_frame(position_events, index)
        price_df, original_price_df, fx_currency_map, warnings = build_price_frame(
            quantities_df.columns.tolist(),
            start_date,
            end_date,
        )
        market_values = quantities_df * price_df
        holdings_value = market_values.sum(axis=1)
        current_holdings = summarize_current_holdings(
            quantities_df,
            price_df,
            original_price_df,
            fx_currency_map,
        )
    else:
        quantities_df = pd.DataFrame(index=index)
        price_df = pd.DataFrame(index=index)
        original_price_df = pd.DataFrame(index=index)
        warnings = []
        holdings_value = pd.Series(0.0, index=index)
        current_holdings = []

    total_value = cash_series.add(holdings_value, fill_value=0.0)
    profit_value = total_value.subtract(external_cash_series, fill_value=0.0)
    result_df = pd.DataFrame(
        {
            "date": index.strftime("%Y-%m-%d"),
            "cash": cash_series.round(2),
            "holdingsValue": holdings_value.round(2),
            "totalValue": total_value.round(2),
            "externalCashFlow": external_cash_series.round(2),
            "profitValue": profit_value.round(2),
        }
    )

    summary = {
        "startDate": result_df.iloc[0]["date"],
        "endDate": result_df.iloc[-1]["date"],
        "currentCash": round(float(cash_series.iloc[-1]), 2),
        "currentHoldingsValue": round(float(holdings_value.iloc[-1]), 2),
        "currentTotalValue": round(float(total_value.iloc[-1]), 2),
        "currentProfitValue": round(float(profit_value.iloc[-1]), 2),
        "netExternalCashFlow": round(float(external_cash_series.iloc[-1]), 2),
        "currentProfitPercent": round(
            (float(profit_value.iloc[-1]) / float(external_cash_series.iloc[-1])) * 100,
            2,
        )
        if not math.isclose(float(external_cash_series.iloc[-1]), 0.0, abs_tol=1e-9)
        else 0.0,
        "peakValue": round(float(total_value.max()), 2),
        "lowestValue": round(float(total_value.min()), 2),
    }

    benchmark_series, benchmark_warnings = build_benchmark_series(start_date, end_date, index, trade_cash_events)
    warnings.extend(benchmark_warnings)

    return {
        "summary": summary,
        "series": result_df.to_dict(orient="records"),
        "holdings": current_holdings,
        "benchmarks": benchmark_series,
        "warnings": warnings,
    }


def build_quantities_frame(events: list[PositionEvent], index: pd.DatetimeIndex) -> pd.DataFrame:
    tickers = sorted({event.yahoo_ticker for event in events})
    quantities = pd.DataFrame(0.0, index=index, columns=tickers)
    for event in events:
        quantities.loc[pd.Timestamp(event.trade_date), event.yahoo_ticker] += event.quantity_delta
    return quantities.cumsum()


def build_price_frame(
    yahoo_tickers: list[str],
    start_date: date,
    end_date: date,
) -> tuple[pd.DataFrame, pd.DataFrame, dict[str, str], list[str]]:
    index = pd.date_range(start=start_date, end=end_date, freq="D")
    prices = pd.DataFrame(index=index)
    original_prices = pd.DataFrame(index=index)
    currency_map: dict[str, str] = {}
    warnings: list[str] = []

    for ticker in yahoo_tickers:
        if not ticker:
            continue

        history = download_close_series(ticker, start_date, end_date)
        if history.empty:
            warnings.append(f"No price history found for {ticker}.")
            prices[ticker] = 0.0
            original_prices[ticker] = 0.0
            currency_map[ticker] = guess_currency_from_symbol(ticker)
            continue

        currency = resolve_currency(ticker)
        currency_map[ticker] = currency
        history = history.reindex(index).ffill().fillna(0.0)
        original_prices[ticker] = history.round(6)

        if currency != "PLN":
            fx_symbol = FX_SYMBOLS.get(currency)
            if not fx_symbol:
                warnings.append(f"No FX mapping configured for {ticker} currency {currency}.")
                prices[ticker] = 0.0
                continue

            fx_history = download_close_series(fx_symbol, start_date, end_date)
            if fx_history.empty:
                warnings.append(f"No FX history found for currency {currency} used by {ticker}.")
                prices[ticker] = 0.0
                continue
            fx_history = fx_history.reindex(index).ffill().bfill().fillna(0.0)
            history = history * fx_history

        prices[ticker] = history.round(6)

    return prices.fillna(0.0), original_prices.fillna(0.0), currency_map, warnings


def download_close_series(symbol: str, start_date: date, end_date: date) -> pd.Series:
    end_plus_one = end_date + timedelta(days=1)
    with without_dead_local_proxy():
        try:
            data = yf.download(
                symbol,
                start=start_date.isoformat(),
                end=end_plus_one.isoformat(),
                auto_adjust=False,
                progress=False,
                group_by="column",
                threads=False,
            )
        except Exception:
            return pd.Series(dtype=float)
    if data is None or data.empty:
        return pd.Series(dtype=float)

    close_series: pd.Series
    if isinstance(data.columns, pd.MultiIndex):
        close_series = data["Close"].iloc[:, 0]
    else:
        close_series = data["Close"]
    close_series.index = pd.to_datetime(close_series.index).tz_localize(None)
    return close_series.astype(float).sort_index()


def resolve_currency(symbol: str) -> str:
    with without_dead_local_proxy():
        ticker = yf.Ticker(symbol)

        try:
            fast_info = ticker.fast_info
            if fast_info:
                currency = fast_info.get("currency")
                if currency:
                    return str(currency).upper()
        except Exception:
            pass

        try:
            info = ticker.info
            currency = info.get("currency")
            if currency:
                return str(currency).upper()
        except Exception:
            pass

    return guess_currency_from_symbol(symbol)


def guess_currency_from_symbol(symbol: str) -> str:
    upper_symbol = symbol.upper()
    for suffix, currency in CURRENCY_SUFFIX_FALLBACK.items():
        if upper_symbol.endswith(suffix):
            return currency
    return "USD"


def summarize_current_holdings(
    quantities_df: pd.DataFrame,
    prices_df: pd.DataFrame,
    original_prices_df: pd.DataFrame,
    currency_map: dict[str, str],
) -> list[dict[str, Any]]:
    holdings: list[dict[str, Any]] = []
    latest_quantities = quantities_df.iloc[-1]
    latest_prices = prices_df.iloc[-1] if not prices_df.empty else pd.Series(dtype=float)
    latest_original_prices = (
        original_prices_df.iloc[-1] if not original_prices_df.empty else pd.Series(dtype=float)
    )

    for ticker, quantity in latest_quantities.items():
        if math.isclose(float(quantity), 0.0, abs_tol=1e-9):
            continue
        price = float(latest_prices.get(ticker, 0.0))
        original_price = float(latest_original_prices.get(ticker, 0.0))
        original_currency = currency_map.get(ticker, "PLN")
        holdings.append(
            {
                "ticker": ticker,
                "quantity": round(float(quantity), 6),
                "pricePln": round(price, 2),
                "marketValuePln": round(price * float(quantity), 2),
                "priceOriginal": round(original_price, 4),
                "marketValueOriginal": round(original_price * float(quantity), 2),
                "originalCurrency": original_currency,
                "currency": original_currency,
                "insight": fetch_holding_insight(ticker),
            }
        )

    holdings.sort(key=lambda item: item["marketValuePln"], reverse=True)
    return holdings


def build_benchmark_series(
    start_date: date,
    end_date: date,
    index: pd.DatetimeIndex,
    trade_cash_events: list[tuple[date, float]],
) -> tuple[dict[str, Any], list[str]]:
    benchmarks: dict[str, Any] = {}
    warnings: list[str] = []
    trade_cash_by_date: dict[date, float] = {}
    for event_date, amount in trade_cash_events:
        trade_cash_by_date[event_date] = trade_cash_by_date.get(event_date, 0.0) + float(amount)

    for key, config in BENCHMARKS.items():
        history = download_close_series(config["symbol"], start_date, end_date)
        if history.empty:
            warnings.append(f"No benchmark history found for {config['label']} ({config['symbol']}).")
            continue

        history = history.reindex(index).ffill().bfill()
        first_price = float(history[history > 0].iloc[0]) if not history[history > 0].empty else 0.0
        if math.isclose(first_price, 0.0, abs_tol=1e-12):
            warnings.append(f"Benchmark {config['label']} has no usable starting price.")
            continue

        shares = 0.0
        net_invested = 0.0
        values: list[float] = []
        invested_values: list[float] = []
        profit_values: list[float] = []

        for timestamp, price in history.items():
            event_amount = trade_cash_by_date.get(timestamp.date(), 0.0)
            price = float(price)
            if event_amount < 0:
                invested_amount = -event_amount
                shares += invested_amount / price
                net_invested += invested_amount
            elif event_amount > 0:
                sell_shares = min(shares, event_amount / price)
                shares -= sell_shares
                net_invested -= min(net_invested, event_amount)

            value = shares * price
            values.append(value)
            invested_values.append(net_invested)
            profit_values.append(value - net_invested)

        first_value = next((value for value in values if not math.isclose(value, 0.0, abs_tol=1e-9)), 0.0)
        return_pct = [((value / first_value) - 1.0) * 100 if first_value else 0.0 for value in values]
        points = pd.DataFrame(
            {
                "date": index.strftime("%Y-%m-%d"),
                "value": pd.Series(values, index=index).round(2),
                "netInvested": pd.Series(invested_values, index=index).round(2),
                "profitValue": pd.Series(profit_values, index=index).round(2),
                "returnPercent": pd.Series(return_pct, index=index).round(2),
            }
        )

        benchmarks[key] = {
            "label": config["label"],
            "symbol": config["symbol"],
            "series": points.to_dict(orient="records"),
        }

    return benchmarks, warnings


def fetch_holding_insight(symbol: str) -> dict[str, Any]:
    fallback = {
        "name": symbol,
        "sector": None,
        "recommendation": None,
        "recommendationMean": None,
        "analystCount": None,
        "targetMeanPrice": None,
        "targetCurrency": None,
        "source": "Yahoo Finance",
        "asOf": None,
        "summary": "Brak danych analitycznych z Yahoo Finance.",
    }

    fmp_insight = fetch_fmp_recommendation(symbol)
    if fmp_insight:
        return fmp_insight

    with without_dead_local_proxy():
        try:
            info = yf.Ticker(symbol).info or {}
        except Exception:
            return fallback

    recommendation = info.get("recommendationKey")
    recommendation_mean = safe_float(info.get("recommendationMean"))
    analyst_count = safe_int(info.get("numberOfAnalystOpinions"))
    target_mean = safe_float(info.get("targetMeanPrice"))
    name = info.get("shortName") or info.get("longName") or symbol
    sector = info.get("sector")
    currency = info.get("financialCurrency") or info.get("currency")

    if recommendation:
        summary = f"Consensus: {str(recommendation).replace('_', ' ')}"
        if analyst_count:
            summary += f" ({analyst_count} analysts)"
        if target_mean:
            summary += f", target {round(target_mean, 2)} {currency or ''}".rstrip()
        summary += "."
    else:
        summary = "Brak consensusu buy/sell w Yahoo Finance."

    return {
        "name": name,
        "sector": sector,
        "recommendation": recommendation,
        "recommendationMean": recommendation_mean,
        "analystCount": analyst_count,
        "targetMeanPrice": target_mean,
        "targetCurrency": currency,
        "source": "Yahoo Finance",
        "asOf": None,
        "summary": summary,
    }


def fetch_fmp_recommendation(symbol: str) -> dict[str, Any] | None:
    api_key = os.environ.get("FMP_API_KEY")
    if not api_key:
        return None

    fmp_symbol = to_plain_symbol(symbol)
    url = f"https://financialmodelingprep.com/api/v3/analyst-stock-recommendations/{fmp_symbol}"
    try:
        response = httpx.get(url, params={"apikey": api_key}, timeout=8.0)
        response.raise_for_status()
        payload = response.json()
    except Exception:
        return None

    if not isinstance(payload, list) or not payload:
        return None

    latest = payload[0]
    if not isinstance(latest, dict):
        return None

    counts = {
        "strong_buy": safe_int(latest.get("analystRatingsStrongBuy")) or 0,
        "buy": safe_int(latest.get("analystRatingsbuy") or latest.get("analystRatingsBuy")) or 0,
        "hold": safe_int(latest.get("analystRatingsHold")) or 0,
        "sell": safe_int(latest.get("analystRatingsSell")) or 0,
        "strong_sell": safe_int(latest.get("analystRatingsStrongSell")) or 0,
    }
    analyst_count = sum(counts.values()) or None
    recommendation = infer_recommendation_from_counts(counts)
    as_of = latest.get("date")

    summary = f"FMP latest consensus: {recommendation.replace('_', ' ')}"
    if analyst_count:
        summary += f" ({analyst_count} ratings)"
    if as_of:
        summary += f", as of {as_of}"
    summary += "."

    return {
        "name": symbol,
        "sector": None,
        "recommendation": recommendation,
        "recommendationMean": None,
        "analystCount": analyst_count,
        "targetMeanPrice": None,
        "targetCurrency": None,
        "source": "Financial Modeling Prep",
        "asOf": as_of,
        "ratingsBreakdown": counts,
        "summary": summary,
    }


def infer_recommendation_from_counts(counts: dict[str, int]) -> str:
    weights = {
        "strong_buy": 1,
        "buy": 2,
        "hold": 3,
        "sell": 4,
        "strong_sell": 5,
    }
    total = sum(counts.values())
    if not total:
        return "no_data"

    score = sum(count * weights[key] for key, count in counts.items()) / total
    if score <= 1.5:
        return "strong_buy"
    if score <= 2.5:
        return "buy"
    if score <= 3.5:
        return "hold"
    if score <= 4.5:
        return "sell"
    return "strong_sell"


def to_plain_symbol(symbol: str) -> str:
    return symbol.split(".")[0]


def safe_float(value: Any) -> float | None:
    try:
        if value is None:
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def safe_int(value: Any) -> int | None:
    try:
        if value is None:
            return None
        return int(value)
    except (TypeError, ValueError):
        return None


@contextmanager
def without_dead_local_proxy():
    removed: dict[str, str] = {}
    for env_name in PROXY_ENV_NAMES:
        value = os.environ.get(env_name)
        if value and "127.0.0.1:9" in value:
            removed[env_name] = value
            os.environ.pop(env_name, None)
    try:
        yield
    finally:
        for env_name, value in removed.items():
            os.environ[env_name] = value


app = create_app()
