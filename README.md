# Książka Kucharska (PWA)

Offline-first PWA: 2293 własne przepisy, Moja lodówka (tylko dania, na które masz komplet składników, plus „Stwórz z AI”), gotowanie krok po kroku z minutnikami, planer, lista zakupów, ulubione i oceny, import przepisów z linku (gdy opis nie ma pełnego przepisu, AI ogląda film – YouTube bezpośrednio z linku), tekstu i zrzutów ekranu, kopia zapasowa JSON (wczytanie dokłada, nie kasuje) i synchronizacja wybranych urządzeń jednym hasłem przez serwer właściciela (przepisy, zdjęcia, ulubione, oceny, plan, zakupy, lodówka). AI (darmowy klucz Gemini) działa tylko na serwerze: przy imporcie i przy „Stwórz z AI”; reszta działa offline.

## Uruchomienie
    npm install
    npm run dev        # development
    npm run build      # produkcja (dist/)
    npm run data       # przebudowa paczek danych z data-src/recipes-own.json

## GitHub Pages
Wypchnij repo na GitHub (gałąź `main`), w Settings → Pages wybierz „GitHub Actions”. Workflow `.github/workflows/deploy.yml` zbuduje i opublikuje aplikację. Aplikacja używa HashRouter i `base: './'`, więc działa pod dowolną ścieżką repozytorium.

## Struktura
- `src/screens` – ekrany, `src/lib` – dane, dopasowanie lodówki, zakupy, timery, Dexie (IndexedDB)
- `public/data` – indeks + paczki kategorii (ładowane na żądanie), katalog składników
- `tools/` – generator danych i skrypty kontroli jakości przepisów
- `src/lib/keymerge.json` – wspólne reguły kluczy składników dla aplikacji i generatora (`tools/build_data.py`): słowa pomijane i scalanie („żółtka” = „jajka”, „masło miękkie” = „masło”). Po zmianie uruchom `npm run data`.
- `server/` – usługa importu i „Stwórz z AI” (szczegóły w `server/README.md`)
