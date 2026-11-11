# Import przepisów z linku (kucharz-import)

Usługa na serwerze, która z linku (strona, Instagram, TikTok, Facebook, YouTube) albo wklejonego tekstu robi gotowy przepis dla aplikacji.

Instalacja i aktualizacja (serwer NOWY, prompt `root@lewym90`, jedno polecenie):

    bash <(curl -fsSL https://raw.githubusercontent.com/lewym90/kucharz/main/server/install.sh)

Instalator sam bierze klucz Gemini z `/etc/kalendarz-push.env` (jeśli jest), dodaje usługę `kucharz-import` (127.0.0.1:8795) i trasę Caddy `/kucharz-import/`. Sprawdzenie: `https://188-68-247-201.sslip.io/kucharz-import/health`.

Kolejność: dane schema.org ze strony → opis posta → film (Gemini ogląda obraz i słucha dźwięku) → wklejony tekst. Bez klucza Gemini działa tryb awaryjny (reguły, bez filmów).
Limity: 25 importów/h na adres, 200/dobę łącznie, adresy wewnętrzne zablokowane.
