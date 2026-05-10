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
from fastapi import FastAPI, File, HTTPException, UploadFile, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from openpyxl import load_workbook
from sqlalchemy.orm import Session

from .database import get_db, init_db
from .models import CashOperation, ClosedPosition, OpenPosition, PendingOrder, LatestPrice

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
    "wig20": {"symbol": "WIG20.WA", "label": "WIG20"},
    "sp500": {"symbol": "^GSPC", "label": "S&P 500"},
    "nasdaq": {"symbol": "^IXIC", "label": "Nasdaq Composite"},
    "gold": {"symbol": "GC=F", "label": "Gold futures"},
    "bitcoin": {"symbol": "BTC-USD", "label": "Bitcoin"},
}

# Mapping for Stooq symbols (Stooq is often simpler, no .WA/.PL for Polish stocks)
YAHOO_TO_STOOQ_MAP = {
    "CDR.WA": "CDR",
    "XTB.WA": "XTB",
    "PZU.WA": "PZU",
    "PXM.WA": "PXM",
    "TPE.WA": "TPE",
    "KGN.WA": "KGN",
    "INL.WA": "INL",
    "DIG.WA": "DIG",
    "ETL.WA": "ETL",
    "PAS.WA": "PAS",
    "11B.WA": "11B",
    "ACP.WA": "ACP",
    "ALE.WA": "ALE",
    "LPP.WA": "LPP",
    "PKN.WA": "PKN",
    "PKO.WA": "PKO",
    "PEO.WA": "PEO",
    "KGH.WA": "KGH",
    "DNP.WA": "DNP",
    "JSW.WA": "JSW",
    # Indices
    "^GSPC": "^SPX",
    "^IXIC": "^NDX",
    "BTC-USD": "BTCUSD",
    "GC=F": "XAUUSD",
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


from pydantic import BaseModel

class ManualOperation(BaseModel):
    time: str # YYYY-MM-DD
    operation_type: str
    symbol: str | None = None
    amount: float
    comment: str | None = None

def create_app() -> FastAPI:
    init_db()
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

    @app.post("/api/portfolio/manual")
    async def add_manual_operation(op: ManualOperation, db: Session = Depends(get_db)):
        new_op = CashOperation(
            operation_type=op.operation_type,
            symbol=op.symbol,
            time=datetime.strptime(op.time, "%Y-%m-%d"),
            amount=op.amount,
            comment=op.comment
        )
        db.add(new_op)
        db.commit()
        return {"status": "success"}

    @app.get("/api/portfolio")
    async def get_portfolio(db: Session = Depends(get_db)) -> dict[str, Any]:
        # Fetch from DB
        db_cash = db.query(CashOperation).all()
        db_pending = db.query(PendingOrder).all()
        
        cash_events: list[CashEvent] = []
        external_cash_events: list[tuple[date, float]] = []
        trade_cash_events: list[tuple[date, float]] = []
        position_events: list[PositionEvent] = []

        for op in db_cash:
            event_date = op.time.date()
            cash_events.append(CashEvent(event_date=event_date, amount=op.amount, operation_type=op.operation_type))
            
            # Normalize operation types from DB
            op_type_raw = str(op.operation_type or "").strip().lower()
            
            if op_type_raw in {"stock purchase", "stock sale", "stock sell"}:
                trade_cash_events.append((event_date, op.amount))
            elif is_external_cash_operation(op_type_raw):
                external_cash_events.append((event_date, op.amount))
            
            # If it's a purchase/sell, we need quantity deltas
            if op_type_raw in {"stock purchase", "stock sale", "stock sell"}:
                quantity = extract_quantity(op.comment)
                if quantity:
                    delta = quantity if op_type_raw == "stock purchase" else -quantity
                    position_events.append(
                        PositionEvent(
                            ticker=op.symbol,
                            yahoo_ticker=to_yahoo_symbol(op.symbol),
                            quantity_delta=delta,
                            trade_date=event_date,
                        )
                    )

        # Include Pending Orders Margin as tied up cash (negative impact on available cash)
        for order in db_pending:
            if order.margin:
                event_date = order.open_time.date()
                # Assuming margin is positive in DB, it subtracts from available cash
                cash_events.append(CashEvent(event_date=event_date, amount=-float(order.margin), operation_type="Pending Order Margin"))

        if not cash_events and not position_events:
            print("DEBUG: No data found in database.")
            return {"summary": {}, "series": [], "holdings": [], "benchmarks": {}, "warnings": ["No data in database."]}

        portfolio = build_portfolio_history(cash_events, external_cash_events, trade_cash_events, position_events, db)
        return portfolio

    @app.post("/api/portfolio/analyze")
    async def analyze_portfolio(
        files: list[UploadFile] = File(...),
        persist: bool = False,
        db: Session = Depends(get_db)
    ) -> dict[str, Any]:
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

            if persist:
                workbook = load_workbook(io.BytesIO(payload), data_only=True)
                if "Cash Operations" in workbook.sheetnames:
                    sheet = workbook["Cash Operations"]
                    for row in sheet.iter_rows(min_row=6, values_only=True):
                        if not row or not row[0]: continue
                        op = CashOperation(
                            operation_type=str(row[0]).strip(),
                            symbol=(row[1] or "").strip(),
                            time=row[3] if isinstance(row[3], datetime) else None,
                            amount=float(row[4]) if row[4] is not None else 0.0,
                            comment=(row[6] or "").strip()
                        )
                        if op.time:
                            db.add(op)

                pending_sheet_name = next((s for s in workbook.sheetnames if "PENDING ORDERS" in s.upper()), None)
                if pending_sheet_name:
                    sheet = workbook[pending_sheet_name]
                    for row in sheet.iter_rows(min_row=9, values_only=True):
                        if not row or row[0] is None: continue
                        try:
                            order = PendingOrder(
                                order_id=row[0],
                                symbol=row[1],
                                margin=float(row[5]) if row[5] is not None else 0.0,
                                open_time=row[12] if isinstance(row[12], datetime) else None
                            )
                            if order.order_id:
                                db.merge(order)
                        except: continue

        if persist:
            try:
                db.commit()
            except Exception as e:
                db.rollback()
                warnings.append(f"Database sync failed: {str(e)}")

        if not cash_events and not position_events:
            raise HTTPException(status_code=400, detail="No XTB transactions found in uploaded files.")

        portfolio = build_portfolio_history(cash_events, external_cash_events, trade_cash_events, position_events, db)
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

        if operation_type in {"Stock purchase", "Stock sale", "Stock sell"}:
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
        elif operation_type in {"Stock sale", "Stock sell"}:
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

    # Process Pending Orders if sheet exists
    pending_sheet_name = next((s for s in workbook.sheetnames if "PENDING ORDERS" in s.upper()), None)
    if pending_sheet_name:
        sheet = workbook[pending_sheet_name]
        for row in sheet.iter_rows(min_row=9, values_only=True):
            if not row or row[0] is None:
                continue
            try:
                margin = float(row[5]) if row[5] is not None else 0.0
                open_time = row[12]
                if margin > 0 and isinstance(open_time, datetime):
                    cash_events.append(CashEvent(
                        event_date=open_time.date(),
                        amount=-margin,
                        operation_type="Pending Order Margin"
                    ))
            except (ValueError, TypeError, IndexError):
                continue

    return {
        "cash_events": cash_events,
        "external_cash_events": external_cash_events,
        "trade_cash_events": trade_cash_events,
        "position_events": position_events,
        "warnings": warnings,
    }


def is_external_cash_operation(operation_type: str) -> bool:
    normalized = operation_type.lower()
    if any(trade in normalized for trade in ["stock purchase", "stock sale", "stock sell", "trade"]):
        return False
    if any(earning in normalized for earning in ["divident", "interest"]):
        return False
    return any(keyword in normalized for keyword in ["deposit", "withdrawal", "transfer", "wplata", "wyplata"])


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
    db: Session,
) -> dict[str, Any]:
    all_dates = [event.event_date for event in cash_events] + [event.trade_date for event in position_events]
    if not all_dates:
        return {"summary": {}, "series": [], "holdings": [], "benchmarks": {}, "warnings": ["No dates found in events."]}
    
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
            quantities_df,
            start_date,
            end_date,
            db
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

    benchmark_series, benchmark_warnings = build_benchmark_series(start_date, end_date, index, trade_cash_events, db)
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


import json
from pathlib import Path

CACHE_DIR = Path("cache")
CACHE_DIR.mkdir(exist_ok=True)

def get_cached_prices(symbol: str, start_date: date, end_date: date) -> pd.Series | None:
    cache_file = CACHE_DIR / f"{symbol}_{start_date}_{end_date}.csv"
    if cache_file.exists():
        try:
            df = pd.read_csv(cache_file, index_index=0, parse_dates=True)
            series = df.iloc[:, 0]
            series.index = pd.to_datetime(series.index)
            return series
        except:
            return None
    return None

def save_cached_prices(symbol: str, start_date: date, end_date: date, series: pd.Series):
    cache_file = CACHE_DIR / f"{symbol}_{start_date}_{end_date}.csv"
    series.to_csv(cache_file)

import requests

def get_yf_session():
    return None

def get_investing_fx(currency: str) -> float | None:
    if currency == "PLN":
        return 1.0
    pair_map = {"USD": "usd-pln", "EUR": "eur-pln", "GBP": "gbp-pln", "CHF": "chf-pln"}
    pair = pair_map.get(currency.upper())
    if not pair: return None
    url = f"https://www.investing.com/currencies/{pair}"
    headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'}
    try:
        import requests
        r = requests.get(url, headers=headers, timeout=10.0)
        if r.status_code == 200:
            import re
            m = re.search(r'\"ask\":\s*\"([\d\.,]+)\"', r.text)
            if m: return float(m.group(1).replace(',', ''))
            m = re.search(r'instrument-price-last\">([\d\.,]+)', r.text)
            if m: return float(m.group(1).replace(',', ''))
    except Exception as e:
        print(f"DEBUG: Investing.com FX fetch failed for {currency}: {e}")
    return None

def fetch_stooq_price(symbol: str) -> float | None:
    """Fetch the latest closing price from Stooq.pl using API key."""
    api_key = os.getenv("STOOQ_API_KEY")
    if not api_key: return None
    stooq_symbol = YAHOO_TO_STOOQ_MAP.get(symbol, symbol.replace(".WA", "").replace(".PL", ""))
    url = f"https://stooq.pl/q/d/l/?s={stooq_symbol.lower()}&i=d&apikey={api_key}"
    headers = {'User-Agent': 'Mozilla/5.0'}
    try:
        import httpx
        r = httpx.get(url, headers=headers, timeout=10.0)
        if r.status_code == 200:
            df = pd.read_csv(io.StringIO(r.text))
            if not df.empty and 'Zamkniecie' in df.columns:
                return float(df['Zamkniecie'].iloc[-1])
    except Exception as e:
        print(f"DEBUG: Stooq single fetch failed for {symbol} ({stooq_symbol}): {e}")
    return None

def build_price_frame(
    quantities_df: pd.DataFrame,
    start_date: date,
    end_date: date,
    db: Session,
) -> tuple[pd.DataFrame, pd.DataFrame, dict[str, str], list[str]]:
    index = pd.date_range(start=start_date, end=end_date, freq="D")
    prices = pd.DataFrame(index=index)
    original_prices = pd.DataFrame(index=index)
    currency_map: dict[str, str] = {}
    warnings: list[str] = []

    yahoo_tickers = quantities_df.columns.tolist()
    unique_tickers = sorted(list(set(t for t in yahoo_tickers if t)))
    latest_quantities = quantities_df.iloc[-1]
    active_tickers = [t for t in unique_tickers if latest_quantities[t] > 1e-6]
    benchmark_tickers = [b["symbol"] for b in BENCHMARKS.values()]
    all_to_fetch = list(set(active_tickers) | set(benchmark_tickers))

    for ticker in unique_tickers:
        currency_map[ticker] = resolve_currency(ticker)

    # 1. YAHOO FETCH
    data = pd.DataFrame()
    if all_to_fetch:
        print(f"DEBUG: Downloading {len(all_to_fetch)} symbols from Yahoo...")
        end_plus_one = end_date + timedelta(days=1)
        with without_dead_local_proxy():
            try:
                data = yf.download(all_to_fetch, start=start_date.isoformat(), end=end_plus_one.isoformat(), auto_adjust=False, progress=False, group_by="column", threads=True)
            except Exception as e:
                print(f"DEBUG: Yahoo bulk download failed: {e}")

    # 2. FX rates from Investing.com
    unique_currencies = set(currency_map.values()) - {"PLN"}
    fx_rates = {}
    for curr in unique_currencies:
        rate = get_investing_fx(curr)
        if rate:
            fx_rates[curr] = rate
            lp = db.query(LatestPrice).filter(LatestPrice.symbol == curr).first()
            if not lp:
                lp = LatestPrice(symbol=curr)
                db.add(lp)
            lp.price = rate
            lp.currency = "PLN"
            lp.last_updated = datetime.utcnow()
        else:
            lp = db.query(LatestPrice).filter(LatestPrice.symbol == curr).first()
            if lp: fx_rates[curr] = lp.price
            else:
                fx_fallbacks = {"USD": 4.0, "EUR": 4.3, "GBP": 5.0}
                fx_rates[curr] = fx_fallbacks.get(curr, 1.0)
                warnings.append(f"Could not fetch {curr}/PLN. Using fallback {fx_rates[curr]}.")

    # 3. Persist Benchmark prices & Handle Fallbacks
    for bt in benchmark_tickers:
        history = pd.Series(dtype=float)
        if not data.empty:
            try:
                if len(all_to_fetch) > 1:
                    if "Close" in data.columns: history = data["Close"][bt]
                    elif ("Close", bt) in data.columns: history = data[("Close", bt)]
                else:
                    if "Close" in data.columns: history = data["Close"]
            except: pass
        
        if history.empty or bt == "WIG20.WA":
            stooq_price = fetch_stooq_price(bt)
            if stooq_price:
                history = pd.Series(stooq_price, index=index)
                print(f"DEBUG: Used Stooq for benchmark {bt}: {stooq_price}")

        if not history.empty and not history.isnull().all():
            current_val = float(history.iloc[-1])
            if current_val > 0:
                lp = db.query(LatestPrice).filter(LatestPrice.symbol == bt).first()
                if not lp:
                    lp = LatestPrice(symbol=bt)
                    db.add(lp)
                lp.price = current_val
                lp.currency = "INDEX" if bt.startswith("^") or "WIG" in bt else "USD"
                lp.last_updated = datetime.utcnow()

    xtb_reverse_map = {}
    db_open = db.query(OpenPosition).all()
    for op in db_open: xtb_reverse_map[to_yahoo_symbol(op.symbol)] = op.symbol
    db_closed = db.query(ClosedPosition).all()
    for cp in db_closed: xtb_reverse_map[to_yahoo_symbol(cp.symbol)] = cp.symbol

    for ticker in unique_tickers:
        history = pd.Series(dtype=float)
        if not data.empty and ticker in active_tickers:
            try:
                if len(all_to_fetch) > 1:
                    if "Close" in data.columns: history = data["Close"][ticker]
                    elif ("Close", ticker) in data.columns: history = data[("Close", ticker)]
                else:
                    if "Close" in data.columns: history = data["Close"]
            except: pass
        
        if (history.empty or history.isnull().all()) and ticker in active_tickers:
            stooq_price = fetch_stooq_price(ticker)
            if stooq_price:
                history = pd.Series(stooq_price, index=index)
                print(f"DEBUG: Stooq fallback for ticker {ticker}: {stooq_price}")

        if not history.empty and not history.isnull().all():
            current_val = float(history.iloc[-1])
            if current_val > 0:
                lp = db.query(LatestPrice).filter(LatestPrice.symbol == ticker).first()
                if not lp:
                    lp = LatestPrice(symbol=ticker)
                    db.add(lp)
                lp.price = current_val
                lp.currency = currency_map.get(ticker)
                lp.last_updated = datetime.utcnow()

        if history.empty or history.isnull().all():
            lp = db.query(LatestPrice).filter(LatestPrice.symbol == ticker).first()
            if lp and lp.price:
                history = pd.Series(lp.price, index=index)
            else:
                xtb_symbol = xtb_reverse_map.get(ticker, ticker.replace(".WA", ".PL"))
                latest_op = db.query(OpenPosition).filter(OpenPosition.symbol == xtb_symbol).first()
                market_price = latest_op.market_price if latest_op else 0.0
                last_cp = db.query(ClosedPosition).filter(ClosedPosition.symbol == xtb_symbol).order_by(ClosedPosition.close_time.desc()).first()
                close_price = last_cp.close_price if last_cp else 0.0
                if market_price > 0: history = pd.Series(market_price, index=index)
                elif close_price > 0: history = pd.Series(close_price, index=index)
                else: history = pd.Series(0.0, index=index)

        history = history.reindex(index).ffill().bfill().fillna(0.0)
        original_prices[ticker] = history.round(6)
        curr = currency_map[ticker]
        if curr != "PLN":
            rate = fx_rates.get(curr, 1.0)
            prices[ticker] = (history * rate).round(6)
        else:
            prices[ticker] = history.round(6)

    try: db.commit()
    except: db.rollback()
    return prices.fillna(0.0), original_prices.fillna(0.0), currency_map, warnings


def download_close_series(symbol: str, start_date: date, end_date: date) -> pd.Series:
    end_plus_one = end_date + timedelta(days=1)
    with without_dead_local_proxy():
        try:
            data = yf.download(symbol, start=start_date.isoformat(), end=end_plus_one.isoformat(), auto_adjust=False, progress=False, threads=False)
        except Exception: return pd.Series(dtype=float)
    if data is None or data.empty: return pd.Series(dtype=float)
    if isinstance(data.columns, pd.MultiIndex): close_series = data["Close"].iloc[:, 0]
    else: close_series = data["Close"]
    close_series.index = pd.to_datetime(close_series.index).tz_localize(None)
    return close_series.astype(float).sort_index()


def resolve_currency(symbol: str) -> str:
    guessed = guess_currency_from_symbol(symbol)
    if guessed != "USD": return guessed
    with without_dead_local_proxy():
        ticker = yf.Ticker(symbol)
        try:
            fast_info = ticker.fast_info
            if fast_info:
                currency = fast_info.get("currency")
                if currency: return str(currency).upper()
        except Exception: pass
    return guessed


def guess_currency_from_symbol(symbol: str) -> str:
    upper_symbol = symbol.upper()
    for suffix, currency in CURRENCY_SUFFIX_FALLBACK.items():
        if upper_symbol.endswith(suffix): return currency
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
    latest_original_prices = (original_prices_df.iloc[-1] if not original_prices_df.empty else pd.Series(dtype=float))
    for ticker, quantity in latest_quantities.items():
        if math.isclose(float(quantity), 0.0, abs_tol=1e-9): continue
        price = float(latest_prices.get(ticker, 0.0))
        original_price = float(latest_original_prices.get(ticker, 0.0))
        original_currency = currency_map.get(ticker, "PLN")
        holdings.append({
            "ticker": ticker,
            "quantity": round(float(quantity), 6),
            "pricePln": round(price, 2),
            "marketValuePln": round(price * float(quantity), 2),
            "priceOriginal": round(original_price, 4),
            "marketValueOriginal": round(original_price * float(quantity), 2),
            "originalCurrency": original_currency,
            "currency": original_currency,
            "insight": fetch_holding_insight(ticker),
        })
    holdings.sort(key=lambda item: item["marketValuePln"], reverse=True)
    return holdings


from dotenv import load_dotenv

# Load environment variables (API keys, etc.)
load_dotenv()

def fetch_stooq_history(symbol: str) -> pd.Series:
    """Fetch full historical data from Stooq.pl using API key."""
    api_key = os.getenv("STOOQ_API_KEY")
    if not api_key:
        return pd.Series(dtype=float)
        
    url = f"https://stooq.pl/q/d/l/?s={symbol.lower()}&i=d&apikey={api_key}"
    headers = {'User-Agent': 'Mozilla/5.0'}
    
    try:
        import httpx
        r = httpx.get(url, headers=headers, timeout=15.0)
        if r.status_code == 200:
            df = pd.read_csv(io.StringIO(r.text))
            if 'Data' in df.columns and 'Zamkniecie' in df.columns:
                df['Data'] = pd.to_datetime(df['Data'])
                df = df.set_index('Data')
                return df['Zamkniecie'].astype(float).sort_index()
    except Exception as e:
        print(f"DEBUG: Stooq fetch failed for {symbol}: {e}")
        
    return pd.Series(dtype=float)

def build_benchmark_series(
    start_date: date,
    end_date: date,
    index: pd.DatetimeIndex,
    trade_cash_events: list[tuple[date, float]],
    db: Session,
) -> tuple[dict[str, Any], list[str]]:
    benchmarks: dict[str, Any] = {}
    warnings: list[str] = []
    trade_cash_by_date: dict[date, float] = {}
    for event_date, amount in trade_cash_events:
        trade_cash_by_date[event_date] = trade_cash_by_date.get(event_date, 0.0) + float(amount)

    for key, config in BENCHMARKS.items():
        symbol = config["symbol"]
        history = pd.Series(dtype=float)
        
        # 1. SPECIAL CASE: WIG20 from Stooq for full history
        if key == "wig20":
            history = fetch_stooq_history("wig20")
            if not history.empty:
                print(f"DEBUG: Fetched {len(history)} points for WIG20 from Stooq.")
        
        # 2. FALLBACK/STANDARD: Yahoo Finance
        if history.empty:
            history = download_close_series(symbol, start_date, end_date)
        
        # 3. DB FALLBACK
        if history.empty:
            lp = db.query(LatestPrice).filter(LatestPrice.symbol == symbol).first()
            if lp and lp.price:
                history = pd.Series(lp.price, index=index)
            else:
                warnings.append(f"No benchmark history found for {config['label']} ({symbol}).")
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
        points = pd.DataFrame({
            "date": index.strftime("%Y-%m-%d"),
            "value": pd.Series(values, index=index).round(2),
            "netInvested": pd.Series(invested_values, index=index).round(2),
            "profitValue": pd.Series(profit_values, index=index).round(2),
            "returnPercent": pd.Series(return_pct, index=index).round(2),
        })
        benchmarks[key] = {
            "label": config["label"],
            "symbol": config["symbol"],
            "series": points.to_dict(orient="records"),
        }
    return benchmarks, warnings


def fetch_holding_insight(symbol: str) -> dict[str, Any]:
    return {
        "name": symbol,
        "sector": None,
        "recommendation": None,
        "recommendationMean": None,
        "analystCount": None,
        "targetMeanPrice": None,
        "targetCurrency": None,
        "source": "Yahoo Finance (Disabled for speed)",
        "asOf": None,
        "summary": "Analiza wyłączona czasowo w celu uniknięcia limitów Yahoo Finance.",
    }


def fetch_fmp_recommendation(symbol: str) -> dict[str, Any] | None:
    api_key = os.environ.get("FMP_API_KEY")
    if not api_key: return None
    fmp_symbol = to_plain_symbol(symbol)
    url = f"https://financialmodelingprep.com/api/v3/analyst-stock-recommendations/{fmp_symbol}"
    try:
        response = httpx.get(url, params={"apikey": api_key}, timeout=8.0)
        response.raise_for_status()
        payload = response.json()
    except Exception: return None
    if not isinstance(payload, list) or not payload: return None
    latest = payload[0]
    if not isinstance(latest, dict): return None
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
    if analyst_count: summary += f" ({analyst_count} ratings)"
    if as_of: summary += f", as of {as_of}"
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
    weights = {"strong_buy": 1, "buy": 2, "hold": 3, "sell": 4, "strong_sell": 5}
    total = sum(counts.values())
    if not total: return "no_data"
    score = sum(count * weights[key] for key, count in counts.items()) / total
    if score <= 1.5: return "strong_buy"
    if score <= 2.5: return "buy"
    if score <= 3.5: return "hold"
    if score <= 4.5: return "sell"
    return "strong_sell"


def to_plain_symbol(symbol: str) -> str:
    return symbol.split(".")[0]


def safe_float(value: Any) -> float | None:
    try:
        if value is None: return None
        return float(value)
    except (TypeError, ValueError): return None


def safe_int(value: Any) -> int | None:
    try:
        if value is None: return None
        return int(value)
    except (TypeError, ValueError): return None


@contextmanager
def without_dead_local_proxy():
    removed: dict[str, str] = {}
    for env_name in PROXY_ENV_NAMES:
        value = os.environ.get(env_name)
        if value and "127.0.0.1:9" in value:
            removed[env_name] = value
            os.environ.pop(env_name, None)
    try: yield
    finally:
        for env_name, value in removed.items(): os.environ[env_name] = value


app = create_app()
