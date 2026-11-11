# Książka Kucharska (PWA)

Offline-first PWA: 1650 własnych przepisów, Moja lodówka, gotowanie krok po kroku z minutnikami, planer, lista zakupów, ulubione i oceny, kopia zapasowa JSON. Bez AI w czasie działania, bez płatnych API.

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
