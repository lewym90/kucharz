# Import przepisów z linku (kucharz-import)

Usługa na serwerze, która z linku (strona, Instagram, TikTok, Facebook, YouTube), wklejonego tekstu albo zrzutów ekranu robi gotowy przepis dla aplikacji, a w lodówce tworzy przepis z zaznaczonych produktów (`POST /create`).

Instalacja i aktualizacja (serwer NOWY, prompt `root@lewym90`, jedno polecenie):

    bash <(curl -fsSL https://raw.githubusercontent.com/lewym90/kucharz/main/server/install.sh)

Instalator sam bierze klucz Gemini z `/etc/kalendarz-push.env` (jeśli jest), dodaje usługę `kucharz-import` (127.0.0.1:8795) i trasę Caddy `/kucharz-import/`. Sprawdzenie: `https://188-68-247-201.sslip.io/kucharz-import/health`.

Kolejność: dane schema.org ze strony → opis posta + pierwszy komentarz autora (YouTube i Instagram przez yt-dlp, TikTok przez publiczne API komentarzy) → film (Gemini ogląda obraz i słucha dźwięku) → wklejony tekst. Zrzuty ekranu (do 10) czyta Gemini i łączy w jeden przepis. „Stwórz z AI”: najpierw Gemini szuka sprawdzonego przepisu w Google, a gdy żaden nie pasuje, układa nowy – tylko z podanych produktów (+ sól, pieprz, woda, olej, oliwa, cukier); serwer sprawdza listę składników i w razie czego poprawia przepis. Bez klucza Gemini działa tryb awaryjny (reguły, bez filmów, zdjęć i AI). Przy imporcie z linku serwer od razu dołącza zdjęcie dania: okładkę filmu (yt-dlp / og:image), zdjęcie z danych przepisu na stronie, a gdy ich brak – klatkę z filmu w sekundzie wskazanej przez Gemini (ffmpeg). Aktualna wersja zgłasza w /health `"v": 3`.
Limity: 25 importów/h na adres, 200/dobę łącznie, adresy wewnętrzne zablokowane.
