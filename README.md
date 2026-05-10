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

## Konfiguracja i Źródła Danych

### 🔑 Klucz API Stooq (WIG20 i Fallback)

Aplikacja wykorzystuje hybrydowy system pobierania danych. Aby zapewnić pełną historię indeksu **WIG20** oraz stabilne notowania polskich akcji w przypadku blokad Yahoo Finance, zalecane jest użycie darmowego klucza API z serwisu Stooq.pl.

#### Jak zdobyć klucz API Stooq:
1.  Wejdź na stronę generatora klucza: [stooq.pl/q/d/?s=wig20&get_apikey](https://stooq.pl/q/d/?s=wig20&get_apikey). Uwaga: **Ten klucz jest uniwersalny** i będzie działał dla wszystkich walorów w aplikacji, nie tylko dla WIG20.
2.  Rozwiąż test **CAPTCHA**, aby potwierdzić, że nie jesteś botem.
3.  Po rozwiązaniu, **skopiuj link do pobrania pliku CSV** znajdujący się na dole strony. Twój unikalny klucz API to ciąg znaków znajdujący się w tym linku po frazie `&apikey=`.
    *   *Przykład:* Jeśli link kończy się na `&apikey=ABC123XYZ`, Twoim kluczem jest `ABC123XYZ`.
4.  **Uwaga:** Klucz może okresowo wygasać (np. przy zmianie Twojego adresu IP). W przypadku problemów z pobieraniem danych, powtórz procedurę.

#### Instalacja klucza:
1.  W głównym folderze projektu (`XtbStatistics/`) utwórz lub edytuj plik o nazwie `.env`.
2.  Dodaj swój klucz do pliku w następujący sposób:
    ```env
    STOOQ_API_KEY=Twoj_Klucz_Tutaj
    ```
3.  Zrestartuj backend aplikacji. Od teraz historia WIG20 oraz zapasowe źródła cen akcji będą korzystać z autoryzowanego kanału Stooq.

## Uwagi

- Import dziala na arkuszu `Cash Operations` z raportu XTB.
- Wycena koncowa to `gotowka + wartosc pozycji`.
- Dla aktywow zagranicznych backend pobiera takze historie FX do PLN.
- Zrodlo notowan to Yahoo Finance przez biblioteke `yfinance`, czyli rozwiazanie praktyczne, ale nieoficjalne.
