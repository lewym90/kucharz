#!/usr/bin/env bash
# Książka Kucharska: usługa importu przepisów z linku (kucharz-import). Uruchom jako root na serwerze NOWY (prompt root@lewym90):
#   bash <(curl -fsSL https://raw.githubusercontent.com/lewym90/kucharz/main/server/install.sh)
# Bezpieczne do ponownego uruchomienia (zachowuje klucz); to samo polecenie aktualizuje usługę.
# Dodaje osobną usługę kucharz-import (127.0.0.1:8795) i jedną trasę w /etc/caddy/conf.d/kucharz-import.caddy.
# Nie rusza Typera, Egidy ani innych usług. Przy problemie trasa jest wycofywana.
# Klucz Gemini bierze automatycznie z /etc/kalendarz-push.env (jeśli jest) albo z GEMINI_API_KEY=... w poleceniu.
set -uo pipefail
RAW="${RAW:-https://raw.githubusercontent.com/lewym90/kucharz/main/server}"
APP=/opt/kucharz-import; USR=kucharz; ENVF=/etc/kucharz-import.env; PORT=8795
CF="${CADDYFILE:-/etc/caddy/Caddyfile}"; CD="${CONFD:-$(dirname "$CF")/conf.d}"; ROUTE="$CD/kucharz-import.caddy"
say() { printf '== %s\n' "$*"; }
die() { printf 'PRZERWANO: %s\n' "$*" >&2; exit 1; }
[ "$(id -u)" = 0 ] || die "uruchom jako root"
command -v systemctl >/dev/null || die "brak systemd"
command -v caddy >/dev/null || die "nie widzę Caddy"
[ -f "$CF" ] || die "brak $CF"
grep -qF "$CD" "$CF" || die "Caddy nie wczytuje $CD – najpierw uruchom: bash <(curl -fsSL https://raw.githubusercontent.com/lewym90/typer/main/typer/caddy_confd.sh)"
SITE_LINE="$(grep -nE '^[^[:space:]{#(][^{]*\{[[:space:]]*$' "$CF" | head -n1 | cut -d: -f1)"
DOM="$(sed -n "${SITE_LINE}p" "$CF" | sed -E 's/[[:space:]]*\{.*$//; s/[[:space:]].*$//')"
[ -n "$DOM" ] || die "nie ustaliłem domeny z Caddyfile"
health() { [ -n "${SKIP_HEALTH:-}" ] && return 0; curl -fsS -m 10 "https://$DOM/zdrowie" >/dev/null 2>&1; }
HB=0; health && HB=1

# 1) Użytkownik, pakiety, środowisko Python
id "$USR" >/dev/null 2>&1 || useradd --system --home "$APP" --shell /usr/sbin/nologin "$USR" || die "useradd"
mkdir -p "$APP"
if ! command -v ffmpeg >/dev/null; then say "Instaluję ffmpeg (dźwięk z filmów)"; apt-get install -y ffmpeg >/dev/null 2>&1 || say "UWAGA: ffmpeg się nie zainstalował (filmy dłuższe niż 4 minuty nie będą obsłużone)"; fi
command -v python3 >/dev/null || apt-get install -y python3 >/dev/null 2>&1
command -v python3 >/dev/null || die "brak python3"
if ! python3 -m venv "$APP/venv" >/dev/null 2>&1; then apt-get install -y python3-venv >/dev/null 2>&1; python3 -m venv "$APP/venv" || die "nie mogę utworzyć środowiska Python"; fi
say "Instaluję/aktualizuję yt-dlp (pobieranie filmów z Instagrama, TikToka, Facebooka, YouTube)"
"$APP/venv/bin/pip" install --quiet --no-cache-dir --upgrade pip yt-dlp >/dev/null 2>&1 || die "pip install yt-dlp"

# 2) Kod usługi
curl -fsSL "$RAW/import-server.py" -o "$APP/import-server.py.new" || die "pobieranie import-server.py"
mv -f "$APP/import-server.py.new" "$APP/import-server.py"; chown -R "$USR":"$USR" "$APP"

# 3) Klucz Gemini (wspólny z Kalendarzem, nie trafia do aplikacji ani do GitHuba)
KEY="${GEMINI_API_KEY:-}"
[ -z "$KEY" ] && [ -f "$ENVF" ] && KEY="$(grep '^GEMINI_API_KEY=' "$ENVF" | cut -d= -f2-)"
[ -z "$KEY" ] && [ -f /etc/kalendarz-push.env ] && KEY="$(grep '^GEMINI_API_KEY=' /etc/kalendarz-push.env | cut -d= -f2-)"
[ -z "$KEY" ] && [ -f /opt/typer/gemini_key ] && KEY="$(tr -d '\r\n ' < /opt/typer/gemini_key)"
if [ -n "$KEY" ]; then
  CODE="$(curl -s -o /dev/null -w '%{http_code}' -m 15 -H "x-goog-api-key: $KEY" 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=5')"
  [ "$CODE" = 200 ] || { say "UWAGA: Google odrzucił klucz (kod $CODE) – import działa w trybie awaryjnym (bez filmów)."; KEY=""; }
else say "UWAGA: brak klucza Gemini – import działa w trybie awaryjnym (strony z przepisami i wklejony tekst, bez filmów)"; fi
umask 077; printf 'GEMINI_API_KEY=%s\nALLOW_ORIGINS=https://lewym90.github.io\n' "$KEY" > "$ENVF"; chmod 600 "$ENVF"; chown root:"$USR" "$ENVF"; chmod 640 "$ENVF"; umask 022

# 4) Usługa systemd
cat > /etc/systemd/system/kucharz-import.service <<U
[Unit]
Description=Książka Kucharska – import przepisów
After=network-online.target
[Service]
User=$USR
EnvironmentFile=$ENVF
Environment=XDG_CACHE_HOME=/tmp IMPORT_PORT=$PORT YTDLP=$APP/venv/bin/yt-dlp PATH=$APP/venv/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=$APP/venv/bin/python $APP/import-server.py
Restart=always
RestartSec=5
Nice=10
MemoryMax=900M
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=$APP
[Install]
WantedBy=multi-user.target
U
systemctl daemon-reload && systemctl enable --now kucharz-import >/dev/null 2>&1
systemctl restart kucharz-import; sleep 3
systemctl is-active --quiet kucharz-import || { journalctl -u kucharz-import -n 20 --no-pager >&2; die "usługa nie wystartowała (Caddy i Typer nietknięte)"; }
curl -fsS -m 5 "http://127.0.0.1:$PORT/health" >/dev/null || die "usługa nie odpowiada lokalnie"

# 5) Trasa w Caddy (z walidacją i wycofaniem)
mkdir -p "$CD"
[ -f "$ROUTE" ] && cp -p "$ROUTE" "$ROUTE.bak"
cat > "$ROUTE" <<R
handle_path /kucharz-import/* {
	reverse_proxy 127.0.0.1:$PORT
}
R
chmod 755 "$CD"; chmod 644 "$ROUTE"
rollback() { say "WYCOFUJĘ trasę"; if [ -f "$ROUTE.bak" ]; then mv -f "$ROUTE.bak" "$ROUTE"; else rm -f "$ROUTE"; fi; systemctl reload caddy 2>/dev/null || systemctl restart caddy; exit 1; }
caddy validate --config "$CF" --adapter caddyfile >/dev/null 2>&1 || { echo "Caddy odrzucił konfigurację." >&2; rollback; }
systemctl reload caddy || rollback
sleep 3
systemctl is-active --quiet caddy || rollback
if [ $HB = 1 ]; then ok=0; for _ in 1 2 3 4 5 6; do health && { ok=1; break; }; sleep 3; done; [ $ok = 1 ] || { echo "Typer nie odpowiada po zmianie." >&2; rollback; }; fi
rm -f "$ROUTE.bak"
OKR=0; for _ in 1 2 3 4 5; do curl -fsS -m 10 "https://$DOM/kucharz-import/health" >/dev/null 2>&1 && { OKR=1; break; }; sleep 3; done
[ $OKR = 1 ] || say "UWAGA: adres https://$DOM/kucharz-import/health jeszcze nie odpowiada – sprawdź za minutę"
say "GOTOWE. Import przepisów działa: https://$DOM/kucharz-import/health"
[ -n "$KEY" ] && say "Gemini: włączone (filmy, napisy na ekranie i mowa)" || say "Gemini: WYŁĄCZONE (dodaj klucz: GEMINI_API_KEY=... i uruchom to polecenie ponownie)"
