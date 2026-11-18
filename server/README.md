# Import przepisów z linku (kucharz-import)

Usługa na serwerze, która z linku (strona, Instagram, TikTok, Facebook, YouTube), wklejonego tekstu albo zrzutów ekranu robi gotowy przepis dla aplikacji, a w lodówce tworzy przepis z zaznaczonych produktów (`POST /create`).

Instalacja i aktualizacja (serwer NOWY, prompt `root@lewym90`, jedno polecenie):

    bash <(curl -fsSL https://raw.githubusercontent.com/lewym90/kucharz/main/server/install.sh)

Instalator sam bierze klucz Gemini z `/etc/kalendarz-push.env` (jeśli jest), dodaje usługę `kucharz-import` (127.0.0.1:8795) i trasę Caddy `/kucharz-import/`. Sprawdzenie: `https://188-68-247-201.sslip.io/kucharz-import/health`.

Kolejność: dane schema.org ze strony → opis posta + pierwszy komentarz autora (YouTube i Instagram przez yt-dlp, TikTok przez publiczne API komentarzy) → film (Gemini ogląda obraz i słucha dźwięku) → wklejony tekst. Zrzuty ekranu (do 10) czyta Gemini i łączy w jeden przepis. „Stwórz z AI”: najpierw Gemini szuka sprawdzonego przepisu w Google, a gdy żaden nie pasuje, układa nowy – tylko z podanych produktów (+ sól, pieprz, woda, olej, oliwa, cukier); serwer sprawdza listę składników i w razie czego poprawia przepis. Bez klucza Gemini działa tryb awaryjny (reguły, bez filmów, zdjęć i AI). Przy imporcie z linku serwer od razu dołącza zdjęcie dania: okładkę filmu (yt-dlp / og:image), zdjęcie z danych przepisu na stronie, a gdy ich brak – klatkę z filmu w sekundzie wskazanej przez Gemini (ffmpeg). Cały kanał (`POST /channel`, bez AI): yt-dlp pobiera listę filmów kanału YouTube (zakładki Filmy i Shorts) albo profilu TikTok i opisy wszystkich filmów; reguły wyciągają tylko pełne przepisy (min. 3 składniki i 2 kroki) z opisu, z komentarza autora (przypiętego) albo ze strony autora (schema.org). Zadanie działa w tle, aplikacja odpytuje `GET /channel/<id>` i pobiera gotowe przepisy porcjami. Limity: do 1000 filmów na kanał (`CHANNEL_MAX`), 12 kanałów na dobę (`CHANNEL_PER_DAY`), jeden kanał naraz. Profil Instagrama nie działa (Instagram wymaga logowania). Aktualna wersja zgłasza w /health `"v": 4`.
Limity: 25 importów/h na adres, 200/dobę łącznie, adresy wewnętrzne zablokowane.
