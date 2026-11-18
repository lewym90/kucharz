# Książka Kucharska (PWA)

Offline-first PWA: 2293 własne przepisy, Moja lodówka (tylko dania, na które masz komplet składników, plus „Stwórz z AI”), gotowanie krok po kroku z minutnikami, planer, lista zakupów, ulubione i oceny, import przepisów z linku, tekstu, zrzutów ekranu i z całego kanału YouTube/TikTok albo całej strony z przepisami (bez AI, osobna zakładka z nazwą kanału lub strony w „Moje”), kopia zapasowa JSON. AI (darmowy klucz Gemini) działa tylko na serwerze: przy imporcie i przy „Stwórz z AI”; reszta działa offline.

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
