from __future__ import annotations

import io
import math
import os
import re
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

import pandas as pd
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


@dataclass
class PositionEvent:
    ticker: str
    yahoo_ticker: str
    quantity_delta: float
    trade_date: date


def create_app() -> FastAPI:
    app = FastAPI(title="XTB Portfolio History")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "http://localhost:4173",
            "http://127.0.0.1:4173",
        ],
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

        cash_events: list[tuple[date, float]] = []
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
            position_events.extend(parsed["position_events"])
            warnings.extend(parsed["warnings"])

        if not cash_events and not position_events:
            raise HTTPException(status_code=400, detail="No XTB transactions found in uploaded files.")

        portfolio = build_portfolio_history(cash_events, position_events)
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
    cash_events: list[tuple[date, float]] = []
    position_events: list[PositionEvent] = []
    warnings: list[str] = []

    if "Cash Operations" not in workbook.sheetnames:
        warnings.append(f"{filename}: missing 'Cash Operations' sheet.")
        return {"cash_events": cash_events, "position_events": position_events, "warnings": warnings}

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
        cash_events.append((event_date, float(amount)))

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

    return {"cash_events": cash_events, "position_events": position_events, "warnings": warnings}


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
    cash_events: list[tuple[date, float]],
    position_events: list[PositionEvent],
) -> dict[str, Any]:
    all_dates = [event_date for event_date, _ in cash_events] + [event.trade_date for event in position_events]
    start_date = min(all_dates)
    end_date = date.today()
    index = pd.date_range(start=start_date, end=end_date, freq="D")

    cash_series = pd.Series(0.0, index=index)
    for event_date, amount in cash_events:
        cash_series.loc[pd.Timestamp(event_date)] += float(amount)
    cash_series = cash_series.cumsum()

    if position_events:
        quantities_df = build_quantities_frame(position_events, index)
        price_df, fx_currency_map, warnings = build_price_frame(quantities_df.columns.tolist(), start_date, end_date)
        market_values = quantities_df * price_df
        holdings_value = market_values.sum(axis=1)
        current_holdings = summarize_current_holdings(quantities_df, price_df, fx_currency_map)
    else:
        quantities_df = pd.DataFrame(index=index)
        price_df = pd.DataFrame(index=index)
        warnings = []
        holdings_value = pd.Series(0.0, index=index)
        current_holdings = []

    total_value = cash_series.add(holdings_value, fill_value=0.0)
    result_df = pd.DataFrame(
        {
            "date": index.strftime("%Y-%m-%d"),
            "cash": cash_series.round(2),
            "holdingsValue": holdings_value.round(2),
            "totalValue": total_value.round(2),
        }
    )

    summary = {
        "startDate": result_df.iloc[0]["date"],
        "endDate": result_df.iloc[-1]["date"],
        "currentCash": round(float(cash_series.iloc[-1]), 2),
        "currentHoldingsValue": round(float(holdings_value.iloc[-1]), 2),
        "currentTotalValue": round(float(total_value.iloc[-1]), 2),
        "peakValue": round(float(total_value.max()), 2),
        "lowestValue": round(float(total_value.min()), 2),
    }

    return {
        "summary": summary,
        "series": result_df.to_dict(orient="records"),
        "holdings": current_holdings,
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
) -> tuple[pd.DataFrame, dict[str, str], list[str]]:
    index = pd.date_range(start=start_date, end=end_date, freq="D")
    prices = pd.DataFrame(index=index)
    currency_map: dict[str, str] = {}
    warnings: list[str] = []

    for ticker in yahoo_tickers:
        if not ticker:
            continue

        history = download_close_series(ticker, start_date, end_date)
        if history.empty:
            warnings.append(f"No price history found for {ticker}.")
            prices[ticker] = 0.0
            currency_map[ticker] = guess_currency_from_symbol(ticker)
            continue

        currency = resolve_currency(ticker)
        currency_map[ticker] = currency
        history = history.reindex(index).ffill().fillna(0.0)

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

    return prices.fillna(0.0), currency_map, warnings


def download_close_series(symbol: str, start_date: date, end_date: date) -> pd.Series:
    end_plus_one = end_date + timedelta(days=1)
    with without_dead_local_proxy():
        data = yf.download(
            symbol,
            start=start_date.isoformat(),
            end=end_plus_one.isoformat(),
            auto_adjust=False,
            progress=False,
            group_by="column",
            threads=False,
        )
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
    currency_map: dict[str, str],
) -> list[dict[str, Any]]:
    holdings: list[dict[str, Any]] = []
    latest_quantities = quantities_df.iloc[-1]
    latest_prices = prices_df.iloc[-1] if not prices_df.empty else pd.Series(dtype=float)

    for ticker, quantity in latest_quantities.items():
        if math.isclose(float(quantity), 0.0, abs_tol=1e-9):
            continue
        price = float(latest_prices.get(ticker, 0.0))
        holdings.append(
            {
                "ticker": ticker,
                "quantity": round(float(quantity), 6),
                "pricePln": round(price, 2),
                "marketValuePln": round(price * float(quantity), 2),
                "currency": currency_map.get(ticker, "PLN"),
            }
        )

    holdings.sort(key=lambda item: item["marketValuePln"], reverse=True)
    return holdings


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
