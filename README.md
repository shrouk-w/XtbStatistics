# XTB Portfolio History

Prosta aplikacja webowa do wczytywania eksportow XLSX z XTB i rysowania wykresu wartosci konta dzien po dniu.

## Stack

- Backend: FastAPI + `openpyxl` + `pandas` + `yfinance`
- Frontend: React + Vite

## Jak uruchomic

Backend:

```powershell
py -m uvicorn backend.app:app --host 127.0.0.1 --port 8000 --reload
```

Frontend:

```powershell
npm run dev
```

Po uruchomieniu otworz `http://127.0.0.1:5173`.

## Uwagi

- Import dziala na arkuszu `Cash Operations` z raportu XTB.
- Wycena koncowa to `gotowka + wartosc pozycji`.
- Dla aktywow zagranicznych backend pobiera takze historie FX do PLN.
- Zrodlo notowan to Yahoo Finance przez biblioteke `yfinance`, czyli rozwiazanie praktyczne, ale nieoficjalne.
