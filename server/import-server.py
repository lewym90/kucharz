#!/usr/bin/env python3
"""Książka Kucharska: import przepisu z linku (strona, Instagram, TikTok, Facebook, YouTube), z wklejonego tekstu albo ze zdjęć.

POST /import   {"url": "..."}  albo  {"text": "..."}  albo  {"images": [{"mime": "image/jpeg", "data": "<base64>"}, ...]}
               ->  {"ok": true, "recipe": {...}, "how": "..."}
POST /channel  {"url": "https://www.youtube.com/@kanal"}  ->  zadanie w tle (bez AI); GET /channel/<id> (postęp), GET /channel/<id>/recipes?from=N
POST /create   {"ingredients": [...], "category": "obiad", "servings": 2}  ->  przepis z produktów z lodówki (najpierw internet, potem nowy przepis AI)
GET  /health

Kolejność działania (od najtańszej i najdokładniejszej):
 1. strona z danymi schema.org/Recipe  -> składniki i kroki wprost ze strony,
 2. opis/podpis pod filmem (caption)   -> przepis spisany przez autora,
 3. sam film (obraz + dźwięk)          -> Gemini ogląda film (napisy na ekranie i mowa),
 4. wklejony tekst.
Gemini porządkuje wynik do formatu aplikacji (polski, jednostki metryczne). Bez klucza działa tryb awaryjny (reguły).
Nasłuchuje tylko na 127.0.0.1; z internetu wchodzi przez Caddy."""
import base64, html, ipaddress, json, os, re, shutil, socket, subprocess, sys, tempfile, threading, time
import urllib.request, urllib.error, urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from collections import defaultdict, deque

PORT = int(os.environ.get('IMPORT_PORT', '8795'))
GEMINI_KEY = os.environ.get('GEMINI_API_KEY', '')
GEMINI_BASE = os.environ.get('GEMINI_BASE', 'https://generativelanguage.googleapis.com/v1beta')
MODELS = [m for m in os.environ.get('GEMINI_MODELS', 'gemini-3.6-flash,gemini-3.5-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-2.5-flash').split(',') if m]
YTDLP = os.environ.get('YTDLP', shutil.which('yt-dlp') or 'yt-dlp')
ALLOW_ORIGINS = [o for o in os.environ.get('ALLOW_ORIGINS', 'https://lewym90.github.io').split(',') if o]
PER_HOUR = int(os.environ.get('IMPORT_PER_HOUR', '25'))
PER_DAY_ALL = int(os.environ.get('IMPORT_PER_DAY', '200'))
MAX_VIDEO_BYTES = 14 * 1024 * 1024
UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15'
SOCIAL = ('instagram.com', 'tiktok.com', 'facebook.com', 'fb.watch', 'fb.com', 'youtube.com', 'youtu.be', 'pinterest.', 'pin.it', 'x.com', 'twitter.com')
CATS = ['sniadanie', 'obiad', 'zupa', 'makaron', 'kolacja', 'salatka', 'przekaska', 'ciasto', 'deser', 'napoj', 'drink', 'sos']
UNITS = ['g', 'kg', 'ml', 'l', 'łyżka', 'łyżeczka', 'szklanka', 'szczypta', 'szt.', 'ząbek', 'plaster', 'kromka', 'puszka', 'pęczek',
         'garść', 'listek', 'gałązka', 'łodyga', 'opakowanie', 'dash', 'kawałek', 'główka', 'do smaku', 'do podania']
TAGS = ['szybkie', 'wegetariańskie', 'wegańskie', 'bezglutenowe', 'fit', 'na imprezę', 'jednogarnkowe', 'na słodko', 'na ostro']

lock = threading.Semaphore(2)
hits = defaultdict(deque)
day_hits = deque()


class Fail(Exception):
    def __init__(self, code, msg):
        super().__init__(msg)
        self.code, self.msg = code, msg


# ───────────────────────── bezpieczeństwo sieci ─────────────────────────
def safe_host(host):
    if os.environ.get('ALLOW_PRIVATE') == '1':
        return
    try:
        infos = socket.getaddrinfo(host, None)
    except Exception:
        raise Fail('bad_url', 'Nie mogę znaleźć tego adresu.')
    for i in infos:
        ip = ipaddress.ip_address(i[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast or ip.is_unspecified:
            raise Fail('bad_url', 'Ten adres jest niedozwolony.')


def check_url(u):
    p = urllib.parse.urlparse(u)
    if p.scheme not in ('http', 'https') or not p.hostname:
        raise Fail('bad_url', 'To nie wygląda na link.')
    safe_host(p.hostname)
    return p


class SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        check_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


OPENER = urllib.request.build_opener(SafeRedirect)


def http_get(url, ua=UA, limit=3_000_000, timeout=20):
    check_url(url)
    req = urllib.request.Request(url, headers={'User-Agent': ua, 'Accept-Language': 'pl,en;q=0.8', 'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8'})
    try:
        with OPENER.open(req, timeout=timeout) as r:
            raw = r.read(limit)
            ct = r.headers.get_content_charset() or 'utf-8'
    except Fail:
        raise
    except Exception as e:
        raise Fail('fetch', 'Nie udało się pobrać strony (%s).' % type(e).__name__)
    try:
        return raw.decode(ct, 'replace')
    except Exception:
        return raw.decode('utf-8', 'replace')


def http_bytes(url, limit=8_000_000, timeout=12):
    check_url(url)
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'image/avif,image/webp,image/jpeg,image/png,image/*;q=0.8,*/*;q=0.5'})
    with OPENER.open(req, timeout=timeout) as r:
        return (r.headers.get_content_type() or ''), r.read(limit)


def fetch_image(url):
    """Obrazek z sieci jako data URL (zdjęcia z Instagrama/TikToka mają linki ważne tylko chwilę, więc wysyłamy samo zdjęcie)."""
    try:
        url = html.unescape(str(url or '').strip())
        if not url.startswith('http'):
            return None
        ct, raw = http_bytes(url)
        if len(raw) < 4000:
            return None
        if not ct.startswith('image/'):
            ct = 'image/png' if raw[:4] == b'\x89PNG' else 'image/webp' if raw[8:12] == b'WEBP' else 'image/jpeg' if raw[:2] == b'\xff\xd8' else ''
        if ct not in ('image/jpeg', 'image/png', 'image/webp', 'image/avif'):
            return None
        return 'data:%s;base64,%s' % (ct, base64.b64encode(raw).decode())
    except Exception:
        return None


def ld_images(ld):
    out = []
    def walk(x):
        if isinstance(x, str):
            out.append(x)
        elif isinstance(x, list):
            for i in x:
                walk(i)
        elif isinstance(x, dict):
            walk(x.get('url') or x.get('contentUrl') or '')
    walk((ld or {}).get('image'))
    return out


def video_thumbs(info):
    """Okładka filmu (w rolkach i na TikToku zwykle ładne ujęcie gotowego dania), od największej."""
    th = [t for t in (info or {}).get('thumbnails') or [] if t.get('url')]
    th.sort(key=lambda t: (t.get('preference') or 0, (t.get('width') or 0) * (t.get('height') or 0)), reverse=True)
    out = [info.get('thumbnail')] if (info or {}).get('thumbnail') else []
    return out + [t['url'] for t in th if t['url'] not in out][:3]


def video_frame(mime, data, sec):
    """Klatka z pobranego filmu w sekundzie wskazanej przez Gemini (zapas, gdy nie ma okładki)."""
    if not data or not mime.startswith('video') or sec is None or not shutil.which('ffmpeg'):
        return None
    d = tempfile.mkdtemp(prefix='kfr')
    try:
        src, out = os.path.join(d, 'v'), os.path.join(d, 'f.jpg')
        open(src, 'wb').write(data)
        subprocess.run(['ffmpeg', '-loglevel', 'error', '-ss', str(max(0.0, float(sec))), '-i', src, '-frames:v', '1', '-q:v', '3', out], capture_output=True, timeout=30)
        if os.path.exists(out) and os.path.getsize(out) > 3000:
            return 'data:image/jpeg;base64,' + base64.b64encode(open(out, 'rb').read()).decode()
    except Exception:
        pass
    finally:
        shutil.rmtree(d, ignore_errors=True)
    return None


def with_image(r, candidates, frame=None):
    """Dokleja do przepisu zdjęcie dania: pierwsze działające z listy, a gdy nic – klatkę z filmu."""
    if r and not r.get('image'):
        for u in [c for c in candidates if c][:5]:
            img = fetch_image(u)
            if img:
                r['image'] = img
                break
        if not r.get('image') and frame:
            r['image'] = frame
    return r


# ───────────────────────── wyciąganie tekstu ze strony ─────────────────────────
def meta(htm, *names):
    for n in names:
        m = re.search(r'<meta[^>]+(?:property|name)=["\']%s["\'][^>]*content=["\']([^"\']*)["\']' % re.escape(n), htm, re.I) or \
            re.search(r'<meta[^>]+content=["\']([^"\']*)["\'][^>]*(?:property|name)=["\']%s["\']' % re.escape(n), htm, re.I)
        if m:
            return html.unescape(m.group(1)).strip()
    return ''


def html_to_text(htm):
    htm = re.sub(r'(?is)<(script|style|noscript|svg|header|footer|nav|form)[^>]*>.*?</\1>', ' ', htm)
    htm = re.sub(r'(?i)<br\s*/?>|</(p|div|li|h[1-6]|tr|section|article|ul|ol)>', '\n', htm)
    htm = re.sub(r'(?i)<li[^>]*>', '\n- ', htm)
    t = html.unescape(re.sub(r'<[^>]+>', ' ', htm))
    t = re.sub(r'[ \t\r\f\v]+', ' ', t)
    t = re.sub(r'\n\s*\n+', '\n', t)
    return t.strip()


def find_recipe_ld(htm):
    out = []
    for m in re.finditer(r'(?is)<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>', htm):
        try:
            data = json.loads(html.unescape(m.group(1)).strip())
        except Exception:
            try:
                data = json.loads(m.group(1).strip())
            except Exception:
                continue
        stack = [data]
        while stack:
            d = stack.pop()
            if isinstance(d, list):
                stack.extend(d)
            elif isinstance(d, dict):
                t = d.get('@type')
                ts = t if isinstance(t, list) else [t]
                if 'Recipe' in ts:
                    out.append(d)
                for v in d.values():
                    if isinstance(v, (list, dict)):
                        stack.append(v)
    out.sort(key=lambda d: -len(d.get('recipeIngredient') or []))
    return out[0] if out else None


def iso_minutes(s):
    if not s or not isinstance(s, str):
        return 0
    m = re.match(r'P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?', s)
    if not m:
        return 0
    d, h, mi = (int(x or 0) for x in m.groups())
    return d * 1440 + h * 60 + mi


def ld_steps(ins):
    out = []

    def walk(x):
        if isinstance(x, str):
            for p in re.split(r'\n+', html.unescape(re.sub(r'<[^>]+>', ' ', x))):
                p = p.strip()
                if p:
                    out.append(re.sub(r'\s+', ' ', p))
        elif isinstance(x, list):
            for i in x:
                walk(i)
        elif isinstance(x, dict):
            if x.get('itemListElement'):
                walk(x['itemListElement'])
            elif x.get('text'):
                walk(x['text'])
            elif x.get('name'):
                walk(x['name'])
    walk(ins)
    return out


def ld_to_text(ld):
    """Zamienia dane schema.org na zwykły tekst (do Gemini lub do trybu awaryjnego)."""
    ing = [html.unescape(str(i)).strip() for i in (ld.get('recipeIngredient') or ld.get('ingredients') or [])]
    steps = ld_steps(ld.get('recipeInstructions'))
    yld = ld.get('recipeYield')
    yld = ', '.join(map(str, yld)) if isinstance(yld, list) else (yld or '')
    lines = [str(ld.get('name') or '').strip(), html.unescape(str(ld.get('description') or '')).strip()]
    if yld:
        lines.append('Porcje: %s' % yld)
    tm = iso_minutes(ld.get('totalTime')) or iso_minutes(ld.get('cookTime')) + iso_minutes(ld.get('prepTime'))
    if tm:
        lines.append('Czas: %d min' % tm)
    lines.append('Składniki:')
    lines += ['- ' + i for i in ing]
    lines.append('Przygotowanie:')
    lines += ['%d. %s' % (n + 1, s) for n, s in enumerate(steps)]
    return '\n'.join(l for l in lines if l), len(ing), len(steps)


# ───────────────────────── tryb awaryjny: reguły ─────────────────────────
UNIT_MAP = {
    'g': 'g', 'gr': 'g', 'gram': 'g', 'gramy': 'g', 'gramów': 'g', 'kg': 'kg', 'dag': 'dag', 'dkg': 'dag', 'ml': 'ml', 'l': 'l', 'litr': 'l', 'litry': 'l', 'litra': 'l',
    'łyżka': 'łyżka', 'łyżki': 'łyżka', 'łyżek': 'łyżka', 'łyż': 'łyżka', 'łyż.': 'łyżka', 'tbsp': 'łyżka', 'tablespoon': 'łyżka', 'tablespoons': 'łyżka',
    'łyżeczka': 'łyżeczka', 'łyżeczki': 'łyżeczka', 'łyżeczek': 'łyżeczka', 'tsp': 'łyżeczka', 'teaspoon': 'łyżeczka', 'teaspoons': 'łyżeczka',
    'szklanka': 'szklanka', 'szklanki': 'szklanka', 'szklanek': 'szklanka', 'cup': 'szklanka', 'cups': 'szklanka',
    'szczypta': 'szczypta', 'szczypty': 'szczypta', 'szczypt': 'szczypta', 'pinch': 'szczypta',
    'szt': 'szt.', 'szt.': 'szt.', 'sztuka': 'szt.', 'sztuki': 'szt.', 'sztuk': 'szt.', 'ząbek': 'ząbek', 'ząbki': 'ząbek', 'ząbków': 'ząbek',
    'plaster': 'plaster', 'plastry': 'plaster', 'plasterki': 'plaster', 'plasterków': 'plaster', 'kromka': 'kromka', 'kromki': 'kromka', 'kromek': 'kromka',
    'puszka': 'puszka', 'puszki': 'puszka', 'puszek': 'puszka', 'pęczek': 'pęczek', 'pęczki': 'pęczek', 'garść': 'garść', 'garście': 'garść', 'garści': 'garść',
    'opakowanie': 'opakowanie', 'opakowania': 'opakowanie', 'kawałek': 'kawałek', 'kawałki': 'kawałek', 'główka': 'główka', 'główki': 'główka',
    'gałązka': 'gałązka', 'gałązki': 'gałązka', 'łodyga': 'łodyga', 'łodygi': 'łodyga', 'listek': 'listek', 'listki': 'listek', 'liście': 'listek',
    'oz': 'oz', 'ounce': 'oz', 'ounces': 'oz', 'lb': 'lb', 'pound': 'lb', 'pounds': 'lb',
}
FRAC = {'½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125}
HEAD_ING = re.compile(r'^\s*(?:#+\s*)?(?:[^\w\s]{1,3}\s*)?(sk[łl]adniki|ingredients?|potrzebujesz|potrzebujecie|potrzebne(?: b[ęe]d[ąa])?|b[ęe]dzie(?:sz|cie)? potrzebowa\w*|you(?:\'| wi)ll need|na (?:\d+ )?porcj\w+|do przepisu|lista sk[łl]adnik\w*'
                      r'|do (?:przygotowania|zrobienia)\b[^.!?]{0,40}(?:potrzeb\w+|sk[łl]adniki|u[żz]y\w+)\b)\b.*?:?\s*$', re.I)
HEAD_STEP = re.compile(r'^\s*(?:#+\s*)?(przygotowanie|spos[óo]b (?:przygotowania|wykonania)|wykonanie|kroki|instrukcja|instructions?|directions?|method|steps?|jak zrobi[ćc])\b.*?:?\s*$', re.I)

# wartości odżywcze i metadane – nigdy nie są składnikami ani krokami („565 kcal”, „35 g białka”, „B: 35”, „10 min”)
NUTRI = re.compile(r'kcal|kalori|calorie|\bmakr[oa]|macros?\b|warto[śs]\w*\s+od[żz]ywcz|nutrition|w[ęe]glowodan|b[łl]onnik|\bprotein|\bcarbs?\b|\bfats?\b|\bfiber\b'
                   r'|^\W*[BTW]\s*[:=]?\s*\d+[.,]?\d*\s*g?\W*$|(?:^|[|,;]\s*)[BTW]\s*[:=]?\s*\d+[.,]?\d*\s*g?\s*(?:[|,;]|$)'
                   r'|\d+(?:[.,]\d+)?\s*g\s+(?:bia[łl]k[ao]?|t[łl]uszcz\w*|w[ęe]gl\w*)\b(?!\s+(?:jaj|z\s))'
                   r'|(?:bia[łl]k\w*|t[łl]uszcz\w*)\s*[:=-]?\s*\d+(?:[.,]\d+)?\s*g\b', re.I)
NUTRI_HEAD = re.compile(r'^\W*(?:dostajecie|dostajesz|otrzymujecie|otrzymujesz|w jednej porcji|na (?:jedn[aą] )?porcj[eęi]|jedna porcja|1 porcja(?! to)|makro\w*|warto[śs]ci od[żz]ywcze|kalorie|kaloryczno\w*|nutrition|macros?)\b[^.!?]{0,60}:\s*$', re.I)
META_LINE = re.compile(r'^\W*(?:\d+\s*(?:min\w*|h|godz\w*)|\d+\s*porcj\w*|porcj\w*\W*\d+|czas\b.{0,40}|(?:serves|servings?)\W*\d+)\W*$', re.I)
QTY = r'(\d+\s+\d+/\d+|\d+/\d+|\d+(?:[.,]\d+)?(?:\s*[-–]\s*\d+(?:[.,]\d+)?)?\s*[½¼¾⅓⅔⅛]?|[½¼¾⅓⅔⅛])'
TRAIL = re.compile(r'^(.*?[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż].*?)\s*[-–:]?\s*' + QTY + r'\s*([A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż.]+)?\s*(\(.*\))?\s*$')
LEAD_ING = re.compile(r'^\s*(?:[-•*·▪►✔✅👉🔸🔹●○]\s*)?(?:\d+(?:[.,/]\d+)?|[½¼¾⅓⅔⅛])\s*(?:[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż.]+)\b')
BULLET = re.compile(r'^\s*[-•*·▪►✔✅👉🔸🔹●○]\s*\S')


def is_nutri(l):
    return bool(NUTRI.search(l)) and bool(re.search(r'\d', l))


def norm_ing_text(l):
    """„oliwa 30 - ml” → „oliwa 30 ml”."""
    return re.sub(r'(\d)\s*[-–]\s*(g|kg|dag|ml|l|szt\.?|łyż\w*|łyżecz\w*|szklan\w*)\b', r'\1 \2', l)


def is_step_sentence(l):
    """Zdanie z instrukcją, a nie składnik: numerowany krok albo długie zdanie (min. 7 słów, kończy się kropką lub ma przecinek)."""
    t = l.strip()
    if re.match(r'^\s*(?:krok\s*)?\d+\s*[.)]\s+[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]', t, re.I) and len(t.split()) >= 4:
        return True
    return len(t) > 50 and len(t.split()) >= 7 and not ing_like(t) and (t.endswith(('.', '!')) or ', ' in t)


def split_multi(l):
    """„winegret - oliwa 30 ml, sok z cytryny - 15 ml, woda - 15 ml” i „sól, pieprz, papryka słodka” → osobne składniki."""
    body = re.sub(r'^[\s\-•*·▪►✔✅👉🔸🔹●○]+', '', l).strip()
    parts = [x.strip() for x in re.split(r',\s+|;\s*', body) if x.strip()]
    if len(parts) < 2 or any(len(x) > 40 for x in parts):
        return [l]
    with_num = sum(1 for x in parts if re.search(r'\d', x))
    short = all(len(x.split()) <= 3 for x in parts)
    if not (with_num >= 2 or (len(parts) >= 3 and short and with_num == 0)):
        return [l]
    note = ''
    m = re.match(r'^([^\d,]{2,25}?)\s+[-–:]\s+(.*\d.*)$', parts[0])
    if m and with_num >= 2:
        note, parts[0] = m.group(1).strip(), m.group(2)
    return [p + (' (%s)' % note if note else '') for p in parts]


def is_trail_ing(l):
    """„pierś kurczaka 360 g”, „oliwa - 30 ml (…)”, „ogórek 1 szt.” – ilość na końcu."""
    m = TRAIL.match(re.sub(r'^[\s\-•*·▪►✔✅👉🔸🔹●○]+', '', l))
    if not m or len(l) > 90 or len(m.group(1)) > 60:
        return False
    u = (m.group(3) or '').lower()
    return not u or u in UNIT_MAP or u.rstrip('.') in UNIT_MAP


def ing_like(l):
    l = norm_ing_text(l)
    return len(l) < 90 and not l.rstrip().endswith(':') and (bool(LEAD_ING.match(l)) or is_trail_ing(l) or (bool(BULLET.match(l)) and len(l) < 70))


def to_float(tok):
    tok = tok.strip().replace(',', '.')
    if tok in FRAC:
        return FRAC[tok]
    m = re.match(r'^(\d+)\s*([½¼¾⅓⅔⅛])$', tok)
    if m:
        return int(m.group(1)) + FRAC[m.group(2)]
    m = re.match(r'^(\d+)\s+(\d+)/(\d+)$', tok)
    if m:
        return int(m.group(1)) + int(m.group(2)) / int(m.group(3))
    m = re.match(r'^(\d+)/(\d+)$', tok)
    if m:
        return int(m.group(1)) / int(m.group(2))
    m = re.match(r'^(\d+(?:\.\d+)?)(?:\s*[-–]\s*\d+(?:\.\d+)?)?$', tok)
    return float(m.group(1)) if m else None


def parse_ing_line(line):
    s = re.sub(r'^[\s\-•*·▪►✔✅👉➡️🔸🔹▫●○]+', '', line.strip())
    s = re.sub(r'^\d+[.)]\s+(?=\d)', '', s)
    s = s.strip(' -•*·')
    s = re.sub(r'\s+', ' ', s)
    if not s:
        return None
    m = re.match(r'^(\d+\s+\d+/\d+|\d+/\d+|\d+(?:[.,]\d+)?(?:\s*[-–]\s*\d+(?:[.,]\d+)?)?\s*[½¼¾⅓⅔⅛]?|[½¼¾⅓⅔⅛])\s*(.*)$', s)
    if not m and is_trail_ing(s):
        t = TRAIL.match(s)
        u = (t.group(3) or '').lower()
        u = UNIT_MAP.get(u) or UNIT_MAP.get(u.rstrip('.'))
        name = t.group(1).strip(' -–:,.') + (' ' + t.group(4) if t.group(4) else '')
        return conv_unit(name, to_float(re.split(r'\s*[-–]\s*', t.group(2))[-1]), u)
    if not m:
        pm = re.match(r'^(szczypt\w+|odrobin\w+|pinch of)\s+(.*)$', s, re.I)
        if pm:
            return {'name': pm.group(2).strip(' ,.'), 'qty': 1.0 if pm.group(1).lower().startswith(('szczypt', 'pinch')) else None,
                    'unit': 'szczypta' if pm.group(1).lower().startswith(('szczypt', 'pinch')) else 'do smaku'}
        return {'name': s, 'qty': None, 'unit': 'do smaku' if re.search(r'do smaku|to taste', s, re.I) else None}
    qty = to_float(m.group(1))
    rest = m.group(2)
    um = re.match(r'^([A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż.]+)\b\.?\s*(.*)$', rest)
    unit = None
    if um and um.group(1).lower() in UNIT_MAP:
        unit = UNIT_MAP[um.group(1).lower()]
        rest = um.group(2)
        rest = re.sub(r'^(of|z|ze)\s+', '', rest, flags=re.I)
    return conv_unit(rest.strip(' ,.') or s, qty, unit)


def conv_unit(name, qty, unit):
    if unit == 'dag' and qty is not None:
        qty, unit = qty * 10, 'g'
    elif unit == 'oz' and qty is not None:
        qty, unit = round(qty * 28.35), 'g'
    elif unit == 'lb' and qty is not None:
        qty, unit = round(qty * 453.6), 'g'
    elif unit == 'szklanka' and qty is not None:
        qty, unit = qty * 250, 'ml'
    if unit is None and qty is not None:
        unit = 'szt.'
    return {'name': name, 'qty': qty, 'unit': unit}


def split_sections(text):
    lines = [norm_ing_text(l.rstrip()) for l in text.replace('\r', '').split('\n')]
    ing, steps, other, mode, prev = [], [], [], None, None
    for l in lines:
        if not l.strip():
            continue
        if mode == 'n':
            if (len(l) < 45 or is_nutri(l)) and not HEAD_ING.match(l) and not HEAD_STEP.match(l):
                other.append(l)
                continue  # dalej blok wartości odżywczych
            mode = prev
        if NUTRI_HEAD.match(l):
            prev, mode = mode, 'n'
            other.append(l)
            continue
        if is_nutri(l) or META_LINE.match(l):
            other.append(l)  # makro, kalorie, czas, porcje – tylko do metadanych
            continue
        if HEAD_ING.match(l):
            mode = 'i'
            continue
        if HEAD_STEP.match(l):
            mode = 's'
            continue
        if mode == 'i':
            if l.rstrip().endswith(':') and not re.search(r'\d', l):
                continue  # podsekcja, np. „Sos:”
            if is_step_sentence(l):
                steps.append(l)  # zdanie po liście składników = krok (autor nie dał nagłówka „Przygotowanie”)
                mode = 's'
                continue
            ing.extend(split_multi(l))
        elif mode == 's':
            steps.append(l)
        else:
            other.append(l)
    if not ing:
        # brak nagłówka „Składniki”: składniki to krótkie linie z ilością (na początku albo na końcu) lub punktory
        cand = [i for i, l in enumerate(other) if ing_like(l) and not is_nutri(l) and not META_LINE.match(l) and not NUTRI_HEAD.match(l)]
        if len(cand) >= 3:
            first_ing = cand[0]
            for i in cand:
                ing.extend(split_multi(other[i]))
            rest = [(i, l) for i, l in enumerate(other) if i not in cand]
            if not steps:
                steps = [l for i, l in rest if i > first_ing and len(l) > 30 and not l.rstrip().endswith(':') and not is_nutri(l)]
            other = [l for i, l in rest if l not in steps]
    return other, ing, steps


def heuristic(text, title='', allow_no_steps=False):
    other, ing, steps = split_sections(text)
    items = [x for x in (parse_ing_line(l) for l in ing) if x]
    st = []
    for l in steps:
        l = re.sub(r'^\s*(?:krok\s*)?\d+\s*[.):-]\s*', '', l, flags=re.I)
        l = re.sub(r'^[\s\-•*·▪►✔✅👉🔸🔹●○]+', '', l).strip()
        if l and not re.match(r'^\d+\s*(?:porcj\w*|osób|min\w*)\b[^.]{0,20}$', l, re.I):
            st.append(l)
    if len(items) < 2 or (len(st) < 1 and not allow_no_steps):
        return None
    ttl = title or (other[0][:80] if other else 'Przepis z linku')
    desc = [o for o in other if not (o.rstrip().endswith(':') and len(o) < 30) and not is_nutri(o) and not META_LINE.match(o)
            and not NUTRI_HEAD.match(o) and not re.search(r'https?://|(^|\s)[#@]\w', o)]
    if desc and (not title or desc[0].strip(' #*-').lower() == title.strip().lower() or len(desc[0]) < 60):
        desc = desc[1:] if not title or desc[0].strip(' #*-').lower() == title.strip().lower() else desc
    summ = ' '.join(desc[:2])[:240]
    meta_txt = '\n'.join(other + [l for l in steps if len(l) < 40])
    mm = re.search(r'(\d+)\s*(?:min|minut)', meta_txt, re.I)
    serv = None
    for m2 in re.finditer(r'(\d+)\s*(?:porcj|osób|os\.|servings)|(?:porcj\w*|osób|serves|servings?)\W{0,3}(\d+)(?!\s*(?:kcal|g\b|[.,]\d))', text, re.I):
        v = int(m2.group(1) or m2.group(2))
        if 1 <= v <= 20:
            serv = v
            break
    return {
        'title': ttl.strip(' #*-'), 'summary': summ, 'category': 'obiad', 'minutes': int(mm.group(1)) if mm else 30, 'difficulty': 2,
        'servings': serv or 2, 'cuisine': '', 'tags': [], 'ingredients': items, 'steps': st, 'tip': None,
    }


# ───────────────────────── Gemini ─────────────────────────
SCHEMA = {
    'type': 'OBJECT',
    'properties': {
        'found': {'type': 'BOOLEAN'},
        'title': {'type': 'STRING'}, 'summary': {'type': 'STRING'},
        'category': {'type': 'STRING', 'enum': CATS},
        'minutes': {'type': 'INTEGER'}, 'difficulty': {'type': 'INTEGER'}, 'servings': {'type': 'INTEGER'},
        'cuisine': {'type': 'STRING'},
        'tags': {'type': 'ARRAY', 'items': {'type': 'STRING'}},
        'ingredients': {'type': 'ARRAY', 'items': {'type': 'OBJECT', 'properties': {
            'name': {'type': 'STRING'}, 'qty': {'type': 'NUMBER', 'nullable': True}, 'unit': {'type': 'STRING', 'nullable': True}},
            'required': ['name']}},
        'steps': {'type': 'ARRAY', 'items': {'type': 'STRING'}},
        'tip': {'type': 'STRING', 'nullable': True},
        'dish_time': {'type': 'NUMBER', 'nullable': True},
    },
    'required': ['found'],
}
PROMPT = """Jesteś redaktorem książki kucharskiej. Z materiału poniżej (opis posta, tekst strony, dane przepisu albo film) wyciągnij JEDEN przepis.

ZASADY:
- Wierność źródłu: używaj tylko składników, ilości i kroków, które naprawdę są w materiale (w opisie, na ekranie albo w mowie). Niczego nie dopisuj i nie "poprawiaj" przepisu.
- Jeśli ilości nie podano, ustaw qty = null (nie zgaduj). Dla przypraw "do smaku" ustaw unit = "do smaku".
- Wszystko po polsku (przetłumacz, jeśli źródło jest w innym języku). Nazwy składników w mianowniku liczby pojedynczej lub mnogiej, krótkie, bez ilości, np. "mąka pszenna", "jajka", "pierś z kurczaka".
- Jednostki metryczne. Przelicz cups/oz/lb na g lub ml, a szklankę na 250 ml. Dozwolone jednostki: %(units)s. Gdy składnik liczy się na sztuki, użyj "szt.".
- Kroki: pełne, zrozumiałe zdania w trybie rozkazującym, w kolejności wykonania. Zachowaj temperatury i czasy z materiału. Połącz drobne urywki w sensowne kroki.
- Krok to wyłącznie czynność kucharska (kroić, smażyć, mieszać, piec, podawać). Uwagi autora, pozdrowienia, porady zdrowotne, opowieści, zachęty („pamiętajcie…”, „dajcie znać…”) NIE są krokami – pomiń je albo przenieś jedną najważniejszą do tip.
- Składnik to wyłącznie produkt spożywczy. NIE są składnikami: nagłówki części przepisu (np. „Spód”, „Masa”, „Sos”, „Topping”, „Do podania”), tytuły, numery odcinków, reklamy i polecenia aplikacji lub sklepów, linki, hasztagi, kody rabatowe, wartości odżywcze (kcal, białko, tłuszcz, węglowodany), czas i liczba porcji. Gdy ten sam produkt jest w kilku częściach, dopisz część w nawiasie, np. „cukier (do masy)”.
- Ilość zawsze do qty i unit, nigdy w nazwie: „czosnek – 2 duże ząbki” → name „czosnek”, qty 2, unit „ząbek”; „łyżka miodu” → name „miód”, qty 1, unit „łyżka”; „mieszanka warzyw – 1 opak.” → qty 1, unit „opakowanie” (jeśli nie ma takiej jednostki na liście, zostaw unit null i dopisz „(1 opakowanie)” do nazwy). Gdy podano i gramy, i sztuki, weź gramy, a sztuki daj w nawiasie w nazwie.
- Gdy materiałem jest film: obejrzyj go w całości i spisz WSZYSTKIE czynności, które autor wykonuje lub mówi (także te, których nie ma w opisie), razem ze składnikami pokazanymi na ekranie. Ilości z opisu i napisów na ekranie mają pierwszeństwo przed szacowaniem z obrazu.
- minutes: łączny czas z materiału; jeśli go nie ma, oszacuj rozsądnie. difficulty: 1 (bardzo łatwe) do 4 (trudne). servings: liczba porcji z materiału, a gdy brak, oszacuj.
- category wybierz z listy. tags tylko z: %(tags)s (tylko jeśli naprawdę pasują).
- summary: jedno lub dwa zdania opisu dania. cuisine: np. polska, włoska, azjatycka.
- tip: jedna praktyczna wskazówka z materiału albo null.
- dish_time: tylko gdy materiałem jest film – sekunda filmu, w której najlepiej widać gotowe, podane danie (ładne ujęcie z bliska, bez rąk i napisów, jeśli się da); w innym przypadku null.
- Jeśli w materiale NIE MA przepisu (brak składników lub sposobu wykonania), zwróć {"found": false}.

MATERIAŁ (%(kind)s):
"""


def gemini_call(contents_parts, schema=True, tools=None, temperature=0.15, timeout=120, extra=None):
    """Jedno wywołanie Gemini z kolejnymi modelami na liście. Zwraca (dict albo tekst, cała odpowiedź)."""
    if not GEMINI_KEY:
        raise Fail('no_key', 'Serwer nie ma klucza Gemini.')
    cfg = {'temperature': temperature}
    if schema:
        cfg.update({'responseMimeType': 'application/json', 'responseSchema': SCHEMA})
    if extra:
        cfg.update(extra)
    body = {'contents': [{'parts': contents_parts}], 'generationConfig': cfg}
    if tools:
        body['tools'] = tools
    last = None
    for model in MODELS:
        url = '%s/models/%s:generateContent' % (GEMINI_BASE, model)
        req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_KEY})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                data = json.loads(r.read())
            cand = data['candidates'][0]
            txt = ''.join(p.get('text', '') for p in cand['content']['parts'] if not p.get('thought'))
            return (json.loads(txt) if schema else txt), data
        except urllib.error.HTTPError as e:
            last = 'HTTP %s' % e.code
            if e.code in (400, 429, 500, 503, 404):
                continue
            break
        except Exception as e:
            last = type(e).__name__
            continue
    raise Fail('gemini', 'Gemini nie odpowiedział (%s).' % last)


def gemini(parts, kind, timeout=120, extra=None):
    head = PROMPT % {'units': ', '.join(UNITS), 'tags': ', '.join(TAGS), 'kind': kind}
    return gemini_call([{'text': head}] + parts, timeout=timeout, extra=extra)[0]


# ───────────────────────── film ─────────────────────────
IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'


def ig_embed(url):
    """Instagram: strona osadzenia posta (/embed/captioned/) daje bez logowania pełny opis, autora, okładkę i długość filmu."""
    m = re.search(r'instagram\.com/(?:[\w.]+/)?(?:p|reel|reels|tv)/([\w-]+)', url)
    if not m:
        return None
    try:
        htm = http_get('https://www.instagram.com/p/%s/embed/captioned/' % m.group(1), ua=IPHONE_UA, limit=2_000_000, timeout=15)
    except Exception:
        return None
    out = {'caption': '', 'user': '', 'image': '', 'duration': None}
    try:
        cj = re.search(r'"contextJSON":"((?:[^"\\]|\\.)*)"', htm)
        sm = json.loads(json.loads('"' + cj.group(1) + '"'))['gql_data']['shortcode_media']
        edges = (sm.get('edge_media_to_caption') or {}).get('edges') or []
        out['caption'] = (edges[0]['node']['text'] if edges else '').strip()
        out['user'] = (sm.get('owner') or {}).get('username') or ''
        out['image'] = sm.get('display_url') or sm.get('thumbnail_src') or ''
        out['duration'] = sm.get('video_duration')
    except Exception:
        pass
    if not out['caption']:
        mm = re.search(r'<div class="Caption">(.*?)<div class="CaptionComments', htm, re.S) or re.search(r'class="Caption"[^>]*>(.*?)</div>', htm, re.S)
        if mm:
            t = html.unescape(re.sub(r'<[^>]+>', '', re.sub(r'<br\s*/?>', '\n', mm.group(1)))).strip()
            t = re.sub(r'\s*(View all|Zobacz wszystkie)\s+\d+\s+\w+\s*$', '', t)
            lines = t.split('\n')
            if lines and re.fullmatch(r'[\w.]+', lines[0].strip()):
                t = '\n'.join(lines[1:])
            out['caption'] = t.strip()
    return out if (out['caption'] or out['image']) else None


def yt_id(url):
    m = re.search(r'(?:youtube\.com/(?:watch\?(?:.*&)?v=|shorts/|live/|embed/|v/)|youtu\.be/)([\w-]{11})', url)
    return m.group(1) if m else None


def yt_page(vid):
    """Opis, tytuł, autor i długość filmu prosto ze strony YouTube (szybciej niż yt-dlp i działa, gdy yt-dlp jest blokowany)."""
    req = urllib.request.Request('https://www.youtube.com/watch?v=%s&hl=pl&persist_hl=1' % vid, headers={
        'User-Agent': UA, 'Accept-Language': 'pl,en;q=0.8', 'Cookie': 'CONSENT=YES+cb; SOCS=CAI'})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            htm = r.read(4_000_000).decode('utf-8', 'replace')
    except Exception:
        return None
    def jstr(key):
        m = re.search(r'"%s":"((?:[^"\\]|\\.)*)"' % key, htm)
        try:
            return json.loads('"' + m.group(1) + '"') if m else ''
        except Exception:
            return ''
    out = {'caption': jstr('shortDescription').strip(), 'title': (meta(htm, 'og:title') or jstr('title')).strip(), 'author': jstr('author').strip(), 'duration': None}
    m = re.search(r'"lengthSeconds":"(\d+)"', htm)
    if m:
        out['duration'] = int(m.group(1))
    return out if (out['caption'] or out['title']) else None


def yt_watch(vid, ctx, dur):
    """Gemini ogląda film z YouTube bezpośrednio z linku (serwer niczego nie pobiera). Zwraca przepis albo None."""
    part = {'file_data': {'file_uri': 'https://www.youtube.com/watch?v=' + vid, 'mime_type': 'video/*'}}
    extra = None
    if dur and dur > 600:
        extra = {'mediaResolution': 'MEDIA_RESOLUTION_LOW'}
    if dur and dur > 2100:
        part['video_metadata'] = {'fps': 0.2}
    if dur and dur > 4 * 3600:
        return None
    parts = [part]
    if ctx:
        parts.append({'text': 'Opis filmu i komentarze autora (składniki i ilości z opisu są wiarygodne – użyj ich; kroki i brakujące składniki weź z filmu):\n' + ctx[:8000]})
    g = gemini(parts, 'film z YouTube (obraz, napisy na ekranie i mowa) razem z opisem filmu', timeout=200, extra=extra)
    return g if g.get('found') else None


def ig_meta_caption(d):
    """og:description z Instagrama ma doklejone „123 likes, 4 comments - autor on data: "…"” – zostawiamy sam opis."""
    m = re.match(r'^[\d.,KkMm\s]+(likes?|polubie\w*)[^-]*-\s*[\w.]+\s+(on|dnia)\s+[^:]+:\s*["“](.*)["”]\.?\s*$', d or '', re.S)
    return m.group(3) if m else (d or '')


def partial_from_caption(text, url):
    """Same składniki z opisu (gdy kroki są tylko w filmie, którego nie dało się pobrać)."""
    if GEMINI_KEY:
        try:
            g = gemini([{'text': text[:30000]}], 'opis posta, w którym są składniki, a sposób przygotowania jest tylko w filmie '
                                                 '(zwróć found=true, składniki z opisu i tylko te kroki, które są w opisie; nie wymyślaj kroków)')
            n = norm_recipe(g, url, 'opis-skladniki')
            if len(n['ingredients']) >= 3:
                return n
        except Fail:
            pass
    other, ing, steps = split_sections(text)
    if len(ing) < 3:
        return None
    h = heuristic(text) or {'title': (other[0] if other else 'Przepis z linku')[:120], 'ingredients': [parse_ing_line(l) for l in ing], 'steps': steps}
    h['steps'] = h.get('steps') or []
    return norm_recipe(h, url, 'opis-skladniki')


def ytdlp_selfupdate():
    """yt-dlp raz na dobę sam się aktualizuje (Instagram i TikTok często zmieniają strony, a nowe wersje to naprawiają)."""
    if not os.access(sys.prefix, os.W_OK):
        return
    while True:
        time.sleep(90)
        try:
            subprocess.run([sys.executable, '-m', 'pip', 'install', '-q', '--no-cache-dir', '-U', 'yt-dlp'], capture_output=True, timeout=300)
        except Exception:
            pass
        time.sleep(86400 - 90)


def ytdlp_info(url):
    try:
        out = subprocess.run([YTDLP, '--dump-single-json', '--no-playlist', '--skip-download', '--no-warnings', '--socket-timeout', '15', url],
                             capture_output=True, text=True, timeout=60)
        if out.returncode == 0 and out.stdout.strip():
            return json.loads(out.stdout)
    except Exception:
        pass
    return None


def _norm_user(x):
    return str(x or '').strip().lstrip('@').lower()


def author_comments(url, info, max_comments=60):
    """Komentarze autora pod postem (często tam jest lista składników albo cały przepis).
    YouTube i Instagram przez yt-dlp, TikTok przez publiczne API komentarzy. Zwraca listę tekstów (najstarsze pierwsze)."""
    host = (urllib.parse.urlparse(url).hostname or '').lower()
    names = {_norm_user(info.get(k)) for k in ('channel', 'uploader', 'uploader_id', 'channel_id', 'creator', 'uploader_url') if info.get(k)}
    names.discard('')
    found = []
    try:
        if 'tiktok' in host and info.get('id'):
            api = 'https://www.tiktok.com/api/comment/list/?aid=1988&count=50&cursor=0&aweme_id=%s' % urllib.parse.quote(str(info['id']))
            j = json.loads(http_get(api, limit=2_000_000, timeout=15) or '{}')
            for c in j.get('comments') or []:
                u = c.get('user') or {}
                if _norm_user(u.get('unique_id')) in names or c.get('is_author_digged') and c.get('stick_position') or c.get('label_text') in ('Twórca', 'Creator', 'Autor'):
                    found.append((c.get('create_time') or 0, c.get('text') or ''))
        elif any(h in host for h in ('youtube.com', 'youtu.be', 'instagram.com')):
            out = subprocess.run([YTDLP, '--dump-single-json', '--no-playlist', '--skip-download', '--no-warnings', '--socket-timeout', '15',
                                  '--write-comments', '--extractor-args', 'youtube:max_comments=%d,all,0,0;comment_sort=top' % max_comments, url],
                                 capture_output=True, text=True, timeout=50)
            if out.returncode == 0 and out.stdout.strip():
                j = json.loads(out.stdout)
                for c in j.get('comments') or []:
                    if c.get('parent') not in (None, 'root'):
                        continue
                    if c.get('author_is_uploader') or c.get('is_pinned') or _norm_user(c.get('author')) in names or _norm_user(c.get('author_id')) in names:
                        found.append((c.get('timestamp') or 0, c.get('text') or ''))
    except Exception:
        pass
    found.sort(key=lambda x: x[0] or 9e12)
    texts = []
    for _, t in found:
        t = html.unescape(str(t)).strip()
        if len(t) >= 15 and t not in texts:
            texts.append(t)
    return texts[:4]


def download_media(url, dur):
    """Pobiera mały plik wideo (<=14 MB) albo sam dźwięk. Zwraca (mime, bytes) lub None."""
    d = tempfile.mkdtemp(prefix='kimp')
    try:
        if dur is None or dur <= 240:
            cmd = [YTDLP, '--no-playlist', '--no-warnings', '--socket-timeout', '15', '--max-filesize', str(MAX_VIDEO_BYTES),
                   '-f', 'best[ext=mp4][height<=480]/worst[ext=mp4]/best[height<=480]/worst', '-o', d + '/v.%(ext)s', url]
            subprocess.run(cmd, capture_output=True, timeout=120)
            for f in os.listdir(d):
                p = os.path.join(d, f)
                if os.path.getsize(p) <= MAX_VIDEO_BYTES and f.endswith(('.mp4', '.webm', '.mov')):
                    return ('video/mp4' if f.endswith('.mp4') else 'video/webm' if f.endswith('.webm') else 'video/mov'), open(p, 'rb').read()
        if shutil.which('ffmpeg') and (dur is None or dur <= 1800):
            cmd = [YTDLP, '--no-playlist', '--no-warnings', '--socket-timeout', '15', '-x', '--audio-format', 'mp3',
                   '--postprocessor-args', 'ffmpeg:-ac 1 -ar 16000 -b:a 32k', '-o', d + '/a.%(ext)s', url]
            subprocess.run(cmd, capture_output=True, timeout=240)
            for f in os.listdir(d):
                p = os.path.join(d, f)
                if f.endswith('.mp3') and os.path.getsize(p) <= MAX_VIDEO_BYTES:
                    return 'audio/mp3', open(p, 'rb').read()
    except Exception:
        pass
    finally:
        shutil.rmtree(d, ignore_errors=True)
    return None


# ───────────────────────── składanie przepisu ─────────────────────────
def norm_recipe(r, url='', how=''):
    ings = []
    for i in r.get('ingredients') or []:
        name = re.sub(r'\s+', ' ', str(i.get('name') or '')).strip(' ,.-')
        if not name:
            continue
        q = i.get('qty')
        try:
            q = float(q) if q is not None else None
        except Exception:
            q = None
        u = i.get('unit')
        u = UNIT_MAP.get(str(u).lower(), u) if u else None
        if u and u not in UNITS:
            name, u = ('%s (%s)' % (name, u)), None
        if u == 'szt.' and q is None:
            u = None
        ings.append({'name': name, 'qty': q, 'unit': u})
    steps = [re.sub(r'\s+', ' ', str(s)).strip() for s in (r.get('steps') or []) if str(s).strip()]
    cat = r.get('category') if r.get('category') in CATS else 'obiad'
    tags = [t for t in (r.get('tags') or []) if t in TAGS]
    return {
        'title': (str(r.get('title') or '').strip() or 'Przepis z linku')[:140],
        'summary': str(r.get('summary') or '').strip()[:400],
        'category': cat,
        'minutes': max(1, int(r.get('minutes') or 30)), 'difficulty': min(4, max(1, int(r.get('difficulty') or 2))),
        'servings': min(48, max(1, int(r.get('servings') or 2))), 'cuisine': str(r.get('cuisine') or '').strip()[:40],
        'tags': tags, 'ingredients': ings, 'steps': steps, 'tip': (str(r['tip']).strip() or None) if r.get('tip') else None,
        'source': url, 'how': how,
    }


def valid(r):
    return r and len(r.get('ingredients') or []) >= 2 and len(r.get('steps') or []) >= 1


def recipe_like(text):
    """Czy tekst wygląda jak przepis (żeby nie odpalać filmu, gdy opis wystarcza)."""
    if not text:
        return False
    other, ing, steps = split_sections(text)
    return len(ing) >= 3 and len(steps) >= 1


def structure(text, kind, url, how_prefix):
    if GEMINI_KEY:
        try:
            g = gemini([{'text': text[:30000]}], kind)
            if g.get('found'):
                n = norm_recipe(g, url, how_prefix + '+gemini')
                if valid(n):
                    return n
        except Fail:
            pass
    h = heuristic(text)
    return norm_recipe(h, url, how_prefix + '+reguły') if h else None


def do_import(body):
    if body.get('images'):
        return from_images(body.get('images'), (body.get('text') or '').strip())
    text = (body.get('text') or '').strip()
    url = (body.get('url') or '').strip()
    if text and not url:
        m = re.match(r'^(https?://\S+)$', text)
        if m:
            url, text = m.group(1), ''
    if not url and not text:
        raise Fail('empty', 'Wklej link albo tekst przepisu.')
    if url and not re.match(r'^https?://', url):
        url = 'https://' + url
    if text and not url:
        r = structure(text, 'wklejony tekst', '', 'tekst')
        if not r:
            raise Fail('no_recipe', 'Nie widzę w tym tekście przepisu (składników i sposobu wykonania).')
        return r
    p = check_url(url)
    host = p.hostname.lower()
    social = any(host == s.rstrip('.') or host.endswith('.' + s.rstrip('.')) or (s.endswith('.') and s in host + '.') for s in SOCIAL)
    caption, title, dur, page_ld = '', '', None, None
    info = None
    thumbs = []
    if social:
        ig = 'instagram' in host
        site = 'Instagram' if ig else 'TikTok' if 'tiktok' in host else 'YouTube' if ('youtube' in host or 'youtu.be' in host) else 'Facebook'
        yt = yt_id(url) if site == 'YouTube' else None
        if yt:
            url = 'https://www.youtube.com/watch?v=' + yt
            pg = yt_page(yt)
            if pg:
                caption, title, dur = pg['caption'], pg['title'], pg['duration']
                info = {'id': yt, 'channel': pg['author'], 'title': title, 'duration': dur}
                thumbs = ['https://i.ytimg.com/vi/%s/maxresdefault.jpg' % yt, 'https://i.ytimg.com/vi/%s/hqdefault.jpg' % yt]
        if not caption:
            info = ytdlp_info(url) or info
        if info is None and ig:
            time.sleep(3)
            info = ytdlp_info(url)  # Instagram często odmawia tylko na chwilę
        if info and info.get('description') is not None and not caption:
            caption = (info.get('description') or '').strip()
            title = (info.get('title') or '').strip() or title
            dur = info.get('duration') or dur
            thumbs = video_thumbs(info) or thumbs
        if yt and not thumbs:
            thumbs = ['https://i.ytimg.com/vi/%s/hqdefault.jpg' % yt]
        if ig and (not caption or not thumbs):
            emb = ig_embed(url)  # strona osadzenia posta: pełny opis i okładka bez logowania
            if emb:
                caption = caption or emb['caption']
                thumbs = thumbs or ([emb['image']] if emb['image'] else [])
                dur = dur or emb['duration']
        if not caption or not thumbs:
            try:
                htm = http_get(url, ua='facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)', limit=800_000)
                caption = caption or ig_meta_caption(meta(htm, 'og:description', 'description'))
                title = title or meta(htm, 'og:title')
                thumbs = thumbs or [meta(htm, 'og:image', 'og:image:secure_url', 'twitter:image')]
            except Fail:
                pass
        caption = html.unescape(caption)
        kind = 'opis posta pod filmem'
        # przepis albo składniki często są w pierwszym komentarzu autora
        if info and (not recipe_like(caption) or re.search(r'koment|comment|przepis ni[żz]ej|sk[łl]adniki ni[żz]ej', caption, re.I)):
            cm = author_comments(url, info)
            if cm:
                caption = (caption + '\n\nKOMENTARZ AUTORA POD POSTEM:\n' + '\n\n'.join(cm)).strip()
                kind = 'opis posta i komentarz autora pod postem'
        cap_r = None
        if recipe_like(caption) or (GEMINI_KEY and 'KOMENTARZ AUTORA' in caption and len(caption) > 150):
            cap_r = structure((title + '\n' + caption).strip(), kind, url, 'opis')
            # pełny przepis w opisie – gotowe; jeśli kroków jest mało, autor pewnie mówi je w filmie, więc najpierw film
            if cap_r and len(cap_r['steps']) >= 3:
                return with_image(cap_r, thumbs)
        # link do pełnego przepisu w opisie
        for lk in re.findall(r'https?://[^\s)>\]]+', caption):
            hh = (urllib.parse.urlparse(lk).hostname or '').lower()
            if hh and not any(s.rstrip('.') in hh for s in SOCIAL) and 'linktr.ee' not in hh:
                try:
                    r = from_page(lk, url)
                    if r:
                        return with_image(r, thumbs)
                except Fail:
                    pass
        watched = False
        if GEMINI_KEY and yt:
            # YouTube: AI ogląda film prosto z linku – całość, także długie filmy
            try:
                g = yt_watch(yt, (title + '\n' + caption).strip(), dur)
                watched = True
                if g:
                    n = norm_recipe(g, url, 'film+gemini')
                    if valid(n) and (not cap_r or len(n['steps']) >= len(cap_r['steps'])):
                        return with_image(n, thumbs)
            except Fail:
                watched = False
        if GEMINI_KEY and not watched:
            media = download_media(url, dur)
            if not media and ig:
                time.sleep(3)
                media = download_media(url, dur)
            if media:
                watched = True
                mime, data = media
                ctx = (title + '\n' + caption).strip()
                parts = [{'inline_data': {'mime_type': mime, 'data': base64.b64encode(data).decode()}}]
                if ctx:
                    parts.append({'text': 'Opis posta i komentarze autora (składniki z opisu są wiarygodne – użyj ich ilości; kroki weź z filmu):\n' + ctx[:8000]})
                g = gemini(parts, 'film (obraz, napisy na ekranie i mowa) razem z opisem posta' if mime.startswith('video') else 'nagranie dźwięku z filmu razem z opisem posta')
                if g.get('found'):
                    n = norm_recipe(g, url, 'film+gemini')
                    if valid(n) and (not cap_r or len(n['steps']) >= len(cap_r['steps'])):
                        return with_image(n, thumbs, video_frame(mime, data, g.get('dish_time')) if not thumbs else None)
        if cap_r:
            if not watched and len(cap_r['steps']) < 3:
                cap_r['warning'] = ('%s nie dał teraz pobrać filmu, więc kroki są tylko z opisu i mogą być niepełne. '
                                    'Spróbuj ponownie za kilka minut albo dopisz brakujące kroki.' % site)
            return with_image(cap_r, thumbs)
        # w opisie są same składniki, a filmu nie udało się pobrać – oddajemy składniki zamiast błędu
        other, ing_lines, step_lines = split_sections(caption)
        if not watched and len(ing_lines) >= 3:
            part = partial_from_caption((title + '\n' + caption).strip(), url)
            if part:
                part['warning'] = ('%s nie dał teraz pobrać filmu, a sposób przygotowania jest tylko w nim. Mam składniki z opisu – '
                                   'spróbuj ponownie za kilka minut, żeby dostać kroki, albo dopisz je sam.' % site)
                return with_image(part, thumbs)
        if not caption and info is None:
            raise Fail('blocked', '%s nie wpuścił teraz serwera do tego posta (blokuje automatyczne pobieranie, to nie wina linku). '
                                  'Spróbuj ponownie za kilka minut albo dodaj zrzuty ekranu w zakładce „Ze zdjęć”.' % site)
        if not watched and GEMINI_KEY:
            raise Fail('blocked', '%s nie dał teraz pobrać filmu, a w opisie nie ma przepisu. Spróbuj ponownie za kilka minut '
                                  'albo dodaj zrzuty ekranu w zakładce „Ze zdjęć”.' % site)
        raise Fail('no_recipe', 'Obejrzałem film i przeczytałem opis, ale nie znalazłem w nich przepisu (składników i sposobu przygotowania). '
                                'Jeśli przepis jest np. na zdjęciach w karuzeli, dodaj zrzuty ekranu w zakładce „Ze zdjęć”.')
    r = from_page(url, url)
    if r:
        return r
    raise Fail('no_recipe', 'Nie znalazłem na tej stronie przepisu. Skopiuj tekst przepisu i wklej go w zakładce „Wklej tekst”.')


def from_page(page_url, source_url):
    htm = http_get(page_url)
    ld = find_recipe_ld(htm)
    og = meta(htm, 'og:image', 'og:image:secure_url', 'twitter:image')
    og = urllib.parse.urljoin(page_url, og) if og else ''
    if ld:
        txt, ni, ns = ld_to_text(ld)
        if ni >= 2 and ns >= 1:
            r = structure(txt, 'dane przepisu ze strony', source_url, 'strona')
            if r:
                if not r['title'] or r['title'] == 'Przepis z linku':
                    r['title'] = str(ld.get('name') or r['title'])
                return with_image(r, [urllib.parse.urljoin(page_url, u) for u in ld_images(ld)] + [og])
    body = html_to_text(htm)
    if len(body) > 200:
        if GEMINI_KEY:
            t = (meta(htm, 'og:title') + '\n' + body)[:30000]
            return with_image(structure(t, 'tekst strony internetowej', source_url, 'strona-tekst'), [og])
        h = heuristic(body, meta(htm, 'og:title'))
        if h:
            return with_image(norm_recipe(h, source_url, 'strona-reguły'), [og])
    return None


# ───────────────────────── przepis ze zdjęć / zrzutów ekranu ─────────────────────────
IMG_MIME = ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif')


def from_images(images, text=''):
    if not isinstance(images, list) or not images:
        raise Fail('empty', 'Dodaj przynajmniej jedno zdjęcie.')
    if len(images) > 10:
        raise Fail('size', 'Za dużo zdjęć (najwięcej 10).')
    parts, total = [], 0
    for im in images:
        mime, data = (im.get('mime'), im.get('data')) if isinstance(im, dict) else ('image/jpeg', im)
        data = str(data or '')
        m = re.match(r'^data:([\w/+.-]+);base64,(.*)$', data, re.S)
        if m:
            mime, data = m.group(1), m.group(2)
        if mime not in IMG_MIME:
            mime = 'image/jpeg'
        try:
            raw = base64.b64decode(data, validate=False)
        except Exception:
            raise Fail('json', 'Nie mogę odczytać zdjęcia.')
        total += len(raw)
        if not raw or total > 18 * 1024 * 1024:
            raise Fail('size', 'Zdjęcia są za duże.')
        parts.append({'inline_data': {'mime_type': mime, 'data': base64.b64encode(raw).decode()}})
    if text:
        parts.append({'text': 'Dopisek użytkownika:\n' + text[:4000]})
    kind = ('%d zrzuty ekranu lub zdjęcia (połącz informacje ze WSZYSTKICH: np. składniki na jednym, sposób przygotowania na drugim; '
            'czytaj tekst na obrazach, napisy z filmów i opisy postów; pomiń komentarze innych osób, reklamy i interfejs aplikacji)') % len(parts)
    g = gemini(parts, kind)
    if g.get('found'):
        n = norm_recipe(g, '', 'zdjecia+gemini')
        if valid(n):
            n['source'] = 'Ze zrzutów ekranu'
            return n
    raise Fail('no_recipe', 'Nie widzę przepisu na tych zdjęciach. Dodaj zrzut z listą składników i zrzut ze sposobem przygotowania.')


# ───────────────────────── nowy przepis z lodówki (AI) ─────────────────────────
CAT_LABEL = {'sniadanie': 'śniadanie', 'obiad': 'danie obiadowe', 'zupa': 'zupa', 'makaron': 'danie z makaronem', 'kolacja': 'kolacja',
             'salatka': 'sałatka', 'przekaska': 'przekąska', 'ciasto': 'ciasto lub wypiek', 'deser': 'deser', 'napoj': 'napój bezalkoholowy',
             'drink': 'drink (koktajl alkoholowy)', 'sos': 'sos, dip lub dressing'}
STAPLES_TXT = 'sól, pieprz, woda, olej, oliwa, cukier'
_IGN = set('swiezy swieza swieze swiezo drobno posiekany posiekana posiekane pokrojony pokrojona pokrojone starty starta starte tarty tarta '
           'mielony mielona mielone duzy duza duze maly mala male sredni srednia srednie ugotowany ugotowana ugotowane do podania smaku '
           'kawalki kawalek plasterki kostke kostka cienko grubo opcjonalnie najlepiej okolo dla ze na po lub albo oraz bez'.split())


def _fold(s):
    import unicodedata
    return unicodedata.normalize('NFKD', s.replace('ł', 'l').replace('Ł', 'L')).encode('ascii', 'ignore').decode().lower()


def _stems(txt):
    return {w[:4] for w in re.findall(r'[a-z]{3,}', _fold(txt)) if w not in _IGN}


def extras_in(recipe, allowed):
    ok = set()
    for a in list(allowed) + STAPLES_TXT.split(', ') + ['cukru', 'wody', 'oleju', 'oliwy', 'soli']:
        ok |= _stems(a)
    bad = []
    for i in recipe.get('ingredients') or []:
        st = _stems(i['name'])
        if st and not (st & ok):
            bad.append(i['name'])
    return bad


def create_recipe(body):
    ings = []
    for x in body.get('ingredients') or []:
        x = re.sub(r'\s+', ' ', str(x)).strip()[:60]
        if x and x not in ings:
            ings.append(x)
    ings = ings[:80]
    if not ings:
        raise Fail('empty', 'Zaznacz w lodówce, co masz.')
    cat = body.get('category') if body.get('category') in CATS else ''
    serv = min(12, max(1, int(body.get('servings') or 2)))
    what = CAT_LABEL.get(cat, 'danie')
    have = ', '.join(ings)
    avoid = [str(a)[:60] for a in (body.get('avoid') or [])][:20]
    # 1) najpierw sprawdzony przepis z internetu
    web_prompt = ('Wyszukaj w internecie (Google) sprawdzony, dobrze oceniany przepis typu: %s, który da się przygotować WYŁĄCZNIE z tych produktów: %s. '
                  'Poza nimi wolno użyć tylko: %s. Przepis nie musi wykorzystać wszystkich produktów, ale NIE MOŻE wymagać żadnego innego składnika '
                  '(także przypraw, ziół, nabiału, mąki, bulionu ani dodatków do podania). Szukaj w aktualnych serwisach kulinarnych i na blogach kucharzy. '
                  '%s'
                  'Jeśli znajdziesz taki przepis, przepisz go po polsku: tytuł, liczba porcji, czas, składniki z ilościami, kroki, a na końcu linia '
                  '"ADRES: <pełny adres strony>". Jeśli żaden przepis nie spełnia warunku, odpowiedz jednym słowem: BRAK.') % (
                      what, have, STAPLES_TXT, ('Nie proponuj: %s. ' % ', '.join(avoid)) if avoid else '')
    try:
        txt, data = gemini_call([{'text': web_prompt}], schema=False, tools=[{'google_search': {}}], temperature=0.3, timeout=90)
        if txt and len(txt) > 200 and not txt.strip().upper().startswith('BRAK'):
            m = re.search(r'ADRES:\s*(https?://\S+)', txt)
            src = m.group(1).rstrip(').,]') if m else ''
            chunks = ((data.get('candidates') or [{}])[0].get('groundingMetadata') or {}).get('groundingChunks') or []
            if not src and chunks:
                src = (chunks[0].get('web') or {}).get('uri', '')
            g = gemini([{'text': txt}], 'przepis znaleziony w internecie')
            if g.get('found'):
                n = norm_recipe(g, src, 'ai-internet')
                if valid(n) and not extras_in(n, ings):
                    n['category'] = cat or n['category']
                    n['servings'] = n['servings'] or serv
                    return n
    except Fail:
        pass
    # 2) nowy, autorski przepis
    prompt = ('Jesteś szefem kuchni nowoczesnej restauracji i autorem książek kucharskich. Stwórz JEDEN nowy, bardzo smaczny przepis typu: %s '
              'na %d porcje, WYŁĄCZNIE z produktów, które ktoś ma w lodówce: %s. Poza nimi wolno użyć tylko: %s.\n'
              'ZASADY:\n'
              '- Nie dodawaj ŻADNEGO innego składnika (ani przypraw, ziół, nabiału, mąki, bulionu, dodatków do podania). Nie musisz użyć wszystkich produktów: '
              'wybierz te, które naprawdę do siebie pasują.\n'
              '- Danie ma być dopracowane: balans smaku (słoność, kwasowość, słodycz, tłuszcz, chrupkość) osiągnięty tym, co jest dostępne. '
              'Korzystaj z aktualnych standardów i trendów kulinarnych (np. karmelizacja i głębokie przypieczenie, pieczenie warzyw w wysokiej temperaturze, '
              'emulsje, redukcje, kontrasty tekstur, warzywa w roli głównej, kuchnia bez marnowania), ale tylko gdy to realne w domowej kuchni.\n'
              '- Kroki: szczegółowe, w trybie rozkazującym, z temperaturami, czasami i oznakami gotowości (kolor, konsystencja).\n'
              '- title: apetyczna, konkretna nazwa po polsku. summary: 1–2 zdania, dlaczego to smakuje. tip: jedna praktyczna wskazówka.\n'
              '- Jednostki metryczne, dozwolone jednostki: %s. Nazwy składników krótkie, bez ilości, dokładnie tak jak na liście produktów.\n'
              '- category = "%s". tags tylko z: %s.\n'
              '- Jeśli z tych produktów nie da się zrobić sensownego, smacznego dania tego typu, zwróć {"found": false}.\n') % (
                  what, serv, have, STAPLES_TXT, ', '.join(UNITS), cat or 'obiad', ', '.join(TAGS))
    if avoid:
        prompt += '- Nie proponuj tych dań (już były): %s.\n' % ', '.join(avoid)
    last = None
    for _ in range(2):
        g = gemini_call([{'text': prompt}], temperature=0.85)[0]
        if not g.get('found'):
            raise Fail('no_recipe', 'Z samych tych produktów nie da się zrobić sensownego dania tego typu. Dodaj coś do lodówki albo wybierz inny rodzaj dania.')
        n = norm_recipe(g, '', 'ai-nowy')
        if cat:
            n['category'] = cat
        if not valid(n):
            continue
        bad = extras_in(n, ings)
        if not bad:
            return n
        last = n
        last['extras'] = bad
        prompt += '- POPRZEDNIA PROPOZYCJA używała niedozwolonych składników: %s. Tym razem użyj wyłącznie produktów z listy.\n' % ', '.join(bad)
    if last:
        return last
    raise Fail('no_recipe', 'Nie udało się ułożyć przepisu. Spróbuj jeszcze raz.')


# ───────────────────────── synchronizacja między wybranymi urządzeniami ─────────────────────────
# Jedno hasło = jedna „kuchnia”. Urządzenie wpisuje hasło raz i dostaje własny klucz (token), hasło nie jest nigdzie zapisywane.
# Każdy wpis (przepis, zdjęcie, ulubione, ocena, plan, zakupy, lodówka, zakładka kanału) ma czas zmiany – wygrywa nowsza zmiana.
# Usunięcie to osobny wpis („nagrobek”), więc znika tylko to, co ktoś naprawdę usunął. Codzienna kopia bazy, 30 dni wstecz.
import sqlite3, hashlib, secrets
SYNC_DB = os.environ.get('SYNC_DB', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'sync.db'))
SYNC_TABLES = {'mine', 'photos', 'thumbs', 'favs', 'ratings', 'plan', 'shop', 'pantry', 'colls'}
sync_lock = threading.Lock()
join_hits = defaultdict(deque)
_sdb = None


def sdb():
    global _sdb
    if _sdb is None:
        c = sqlite3.connect(SYNC_DB, check_same_thread=False, timeout=30)
        c.execute('PRAGMA journal_mode=WAL')
        c.executescript("""
            CREATE TABLE IF NOT EXISTS kitchens(id TEXT PRIMARY KEY, created REAL);
            CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY, kitchen TEXT, name TEXT, token_hash TEXT UNIQUE, created REAL, seen REAL);
            CREATE TABLE IF NOT EXISTS records(kitchen TEXT, tbl TEXT, key TEXT, val TEXT, u INTEGER, dev TEXT, seq INTEGER,
                                               PRIMARY KEY(kitchen, tbl, key));
            CREATE INDEX IF NOT EXISTS rec_seq ON records(kitchen, seq);
            CREATE TABLE IF NOT EXISTS counter(id INTEGER PRIMARY KEY CHECK(id = 1), seq INTEGER);
            INSERT OR IGNORE INTO counter(id, seq) VALUES(1, 0);
        """)
        c.commit()
        _sdb = c
    return _sdb


def kitchen_id(pw):
    return hashlib.pbkdf2_hmac('sha256', pw.encode('utf-8'), b'kucharz-sync-v1', 200_000).hex()[:40]


def sync_auth(token):
    if not token:
        raise Fail('auth', 'To urządzenie nie jest połączone z synchronizacją.')
    h = hashlib.sha256(token.encode()).hexdigest()
    with sync_lock:
        row = sdb().execute('SELECT id, kitchen FROM devices WHERE token_hash=?', (h,)).fetchone()
        if not row:
            raise Fail('auth', 'To urządzenie zostało odłączone od synchronizacji. Wpisz hasło jeszcze raz.')
        sdb().execute('UPDATE devices SET seen=? WHERE id=?', (time.time(), row[0]))
        sdb().commit()
    return row[1], row[0]


def devices_of(kitchen, me=None):
    rows = sdb().execute('SELECT id, name, created, seen FROM devices WHERE kitchen=? ORDER BY created', (kitchen,)).fetchall()
    return [{'id': r[0], 'name': r[1], 'created': r[2], 'seen': r[3], 'me': r[0] == me} for r in rows]


def sync_join(body, ip):
    now = time.time()
    q = join_hits[ip]
    while q and now - q[0] > 3600:
        q.popleft()
    if len(q) >= 10:
        raise Fail('limit', 'Za dużo prób hasła. Spróbuj za godzinę.')
    q.append(now)
    pw = str(body.get('password') or '')
    if len(pw) < 6:
        raise Fail('weak', 'Hasło musi mieć co najmniej 6 znaków.')
    name = re.sub(r'\s+', ' ', str(body.get('device') or 'Urządzenie')).strip()[:40] or 'Urządzenie'
    kid = kitchen_id(pw)
    with sync_lock:
        c = sdb()
        exists = c.execute('SELECT 1 FROM kitchens WHERE id=?', (kid,)).fetchone()
        if not exists:
            if not body.get('create'):
                raise Fail('no_kitchen', 'Nie ma jeszcze synchronizacji z takim hasłem.')
            c.execute('INSERT INTO kitchens(id, created) VALUES(?, ?)', (kid, now))
        token = secrets.token_urlsafe(32)
        did = secrets.token_urlsafe(9)
        c.execute('INSERT INTO devices(id, kitchen, name, token_hash, created, seen) VALUES(?,?,?,?,?,?)',
                  (did, kid, name, hashlib.sha256(token.encode()).hexdigest(), now, now))
        c.commit()
        return {'token': token, 'device': did, 'created': not exists, 'devices': devices_of(kid, did)}


def sync_pull(kitchen, since):
    out, size, last = [], 0, since
    with sync_lock:
        rows = sdb().execute('SELECT tbl, key, val, u, dev, seq FROM records WHERE kitchen=? AND seq>? ORDER BY seq LIMIT 3000',
                             (kitchen, since)).fetchall()
        top = sdb().execute('SELECT seq FROM counter WHERE id=1').fetchone()[0]
    for t, k, v, u, d, sq in rows:
        size += len(v or '') + len(k) + 60
        if out and size > 4_000_000:
            break
        out.append({'t': t, 'k': k, 'v': json.loads(v) if v is not None else None, 'u': u, 'd': d})
        last = sq
    return {'records': out, 'last': last, 'more': len(out) < len(rows) or len(rows) == 3000, 'top': top}


def sync_push(kitchen, dev, records):
    if not isinstance(records, list) or len(records) > 5000:
        raise Fail('json', 'Błędne dane synchronizacji.')
    acc, newer, nsize = 0, [], 0
    with sync_lock:
        c = sdb()
        seq = c.execute('SELECT seq FROM counter WHERE id=1').fetchone()[0]
        for r in records:
            t, k, u = r.get('t'), str(r.get('k') or ''), r.get('u')
            if t not in SYNC_TABLES or not k or len(k) > 300 or not isinstance(u, (int, float)):
                continue
            v = r.get('v')
            val = None if v is None else json.dumps(v, ensure_ascii=False, separators=(',', ':'))
            if val is not None and len(val) > 6_000_000:
                continue
            ex = c.execute('SELECT u, val FROM records WHERE kitchen=? AND tbl=? AND key=?', (kitchen, t, k)).fetchone()
            if ex and not (u > ex[0]):
                # na serwerze jest nowsza (albo ta sama) wersja – odsyłamy ją, żeby urządzenie ją przyjęło
                nsize += len(ex[1] or '')
                if nsize < 8_000_000:
                    newer.append({'t': t, 'k': k, 'v': json.loads(ex[1]) if ex[1] is not None else None, 'u': ex[0]})
                continue
            seq += 1
            c.execute('INSERT OR REPLACE INTO records(kitchen, tbl, key, val, u, dev, seq) VALUES(?,?,?,?,?,?,?)',
                      (kitchen, t, k, val, int(u), dev, seq))
            acc += 1
        c.execute('UPDATE counter SET seq=? WHERE id=1', (seq,))
        c.commit()
    return {'accepted': acc, 'last': seq, 'newer': newer}


def sync_backups():
    """Codzienna kopia bazy synchronizacji (30 dni wstecz) w folderze backups obok serwera."""
    d = os.path.join(os.path.dirname(SYNC_DB), 'backups')
    while True:
        time.sleep(60)
        try:
            if os.path.exists(SYNC_DB):
                os.makedirs(d, exist_ok=True)
                f = os.path.join(d, 'sync-%s.db' % time.strftime('%Y-%m-%d'))
                if not os.path.exists(f):
                    with sync_lock:
                        dst = sqlite3.connect(f)
                        sdb().backup(dst)
                        dst.close()
                for n in os.listdir(d):
                    p = os.path.join(d, n)
                    if n.startswith('sync-') and time.time() - os.path.getmtime(p) > 31 * 86400:
                        os.remove(p)
        except Exception:
            pass
        time.sleep(3540)


def sync_get(self, path):
    try:
        qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        kitchen, dev = sync_auth(self.headers.get('X-Sync-Token'))
        if path == '/sync/pull':
            return self.send(200, dict(ok=True, **sync_pull(kitchen, int((qs.get('since') or ['0'])[0]))))
        if path == '/sync/devices':
            with sync_lock:
                return self.send(200, {'ok': True, 'devices': devices_of(kitchen, dev)})
    except Fail as e:
        return self.send(401 if e.code == 'auth' else 422, {'ok': False, 'code': e.code, 'error': e.msg})
    return self.send(404, {'ok': False, 'error': 'nie znaleziono'})


def sync_post(self, path):
    n = int(self.headers.get('Content-Length') or 0)
    if n < 0 or n > 30_000_000:
        return self.send(413, {'ok': False, 'code': 'size', 'error': 'Za duża paczka danych.'})
    try:
        body = json.loads(self.rfile.read(n)) if n else {}
        if path == '/sync/join':
            ip = (self.headers.get('X-Forwarded-For') or self.client_address[0]).split(',')[0].strip()
            return self.send(200, dict(ok=True, **sync_join(body, ip)))
        kitchen, dev = sync_auth(self.headers.get('X-Sync-Token'))
        if path == '/sync/push':
            return self.send(200, dict(ok=True, **sync_push(kitchen, dev, body.get('records'))))
        if path in ('/sync/revoke', '/sync/leave'):
            target = dev if path == '/sync/leave' else str(body.get('device') or '')
            with sync_lock:
                sdb().execute('DELETE FROM devices WHERE id=? AND kitchen=?', (target, kitchen))
                sdb().commit()
                return self.send(200, {'ok': True, 'devices': devices_of(kitchen, dev) if path == '/sync/revoke' else []})
    except Fail as e:
        return self.send(401 if e.code == 'auth' else 429 if e.code == 'limit' else 422, {'ok': False, 'code': e.code, 'error': e.msg})
    except (ValueError, json.JSONDecodeError):
        return self.send(400, {'ok': False, 'code': 'json', 'error': 'Błędne dane.'})
    return self.send(404, {'ok': False, 'error': 'nie znaleziono'})


# ───────────────────────── HTTP ─────────────────────────
class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def cors(self):
        o = self.headers.get('Origin', '')
        if o in ALLOW_ORIGINS or (o.startswith('http://localhost') and 'localhost' in ''.join(ALLOW_ORIGINS + ['localhost'])):
            self.send_header('Access-Control-Allow-Origin', o)
            self.send_header('Vary', 'Origin')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-Sync-Token')
            self.send_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')

    def send(self, code, obj):
        b = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(b)))
        self.cors()
        self.end_headers()
        self.wfile.write(b)

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.end_headers()

    def do_GET(self):
        if urllib.parse.urlparse(self.path).path.startswith('/sync/'):
            return sync_get(self, urllib.parse.urlparse(self.path).path)
        if urllib.parse.urlparse(self.path).path in ('/health', '/zdrowie'):
            return self.send(200, {'ok': True, 'v': 10, 'features': ['youtube-ai', 'synchronizacja', 'komentarze', 'zdjecia', 'lodowka', 'zdjecie-dania', 'instagram-zapas'], 'gemini': bool(GEMINI_KEY), 'ytdlp': bool(shutil.which(YTDLP) or os.path.exists(YTDLP)), 'ffmpeg': bool(shutil.which('ffmpeg'))})
        self.send(404, {'ok': False, 'error': 'nie znaleziono'})

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        if path.startswith('/sync/'):
            return sync_post(self, path)
        if path == '/channel':
            return self.send(410, {'ok': False, 'code': 'gone', 'error': 'Pobieranie całych kanałów zostało wyłączone. Dodawaj przepisy pojedynczymi linkami.'})
        if path not in ('/import', '/create'):
            return self.send(404, {'ok': False, 'error': 'nie znaleziono'})
        ip = (self.headers.get('X-Forwarded-For') or self.client_address[0]).split(',')[0].strip()
        now = time.time()
        q = hits[ip]
        while q and now - q[0] > 3600:
            q.popleft()
        while day_hits and now - day_hits[0] > 86400:
            day_hits.popleft()
        if len(q) >= PER_HOUR or len(day_hits) >= PER_DAY_ALL:
            return self.send(429, {'ok': False, 'code': 'limit', 'error': 'Za dużo importów. Spróbuj za chwilę.'})
        n = int(self.headers.get('Content-Length') or 0)
        if n <= 0 or n > (26_000_000 if path == '/import' else 100_000):
            return self.send(413, {'ok': False, 'code': 'size', 'error': 'Za długi tekst.'})
        try:
            body = json.loads(self.rfile.read(n))
        except Exception:
            return self.send(400, {'ok': False, 'code': 'json', 'error': 'Błędne dane.'})
        if not lock.acquire(timeout=60):
            return self.send(503, {'ok': False, 'code': 'busy', 'error': 'Serwer jest zajęty. Spróbuj za chwilę.'})
        try:
            q.append(now)
            day_hits.append(now)
            r = do_import(body) if path == '/import' else create_recipe(body)
            self.send(200, {'ok': True, 'recipe': r, 'how': r.get('how')})
        except Fail as e:
            self.send(422 if e.code in ('no_recipe', 'empty', 'bad_url', 'size') else 503 if e.code == 'blocked' else 502, {'ok': False, 'code': e.code, 'error': e.msg})
        except Exception as e:
            self.send(500, {'ok': False, 'code': 'internal', 'error': 'Błąd serwera (%s).' % type(e).__name__})
        finally:
            lock.release()


if __name__ == '__main__':
    print('kucharz-import na 127.0.0.1:%d, Gemini: %s' % (PORT, 'tak' if GEMINI_KEY else 'nie'), flush=True)
    threading.Thread(target=ytdlp_selfupdate, daemon=True).start()
    threading.Thread(target=sync_backups, daemon=True).start()
    ThreadingHTTPServer(('127.0.0.1', PORT), H).serve_forever()
