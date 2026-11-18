#!/usr/bin/env python3
"""Książka Kucharska: import przepisu z linku (strona, Instagram, TikTok, Facebook, YouTube), z wklejonego tekstu albo ze zdjęć.

POST /import   {"url": "..."}  albo  {"text": "..."}  albo  {"images": [{"mime": "image/jpeg", "data": "<base64>"}, ...]}
               ->  {"ok": true, "recipe": {...}, "how": "..."}
POST /create   {"ingredients": [...], "category": "obiad", "servings": 2}  ->  przepis z produktów z lodówki (najpierw internet, potem nowy przepis AI)
GET  /health

Kolejność działania (od najtańszej i najdokładniejszej):
 1. strona z danymi schema.org/Recipe  -> składniki i kroki wprost ze strony,
 2. opis/podpis pod filmem (caption)   -> przepis spisany przez autora,
 3. sam film (obraz + dźwięk)          -> Gemini ogląda film (napisy na ekranie i mowa),
 4. wklejony tekst.
Gemini porządkuje wynik do formatu aplikacji (polski, jednostki metryczne). Bez klucza działa tryb awaryjny (reguły).
Nasłuchuje tylko na 127.0.0.1; z internetu wchodzi przez Caddy."""
import base64, html, ipaddress, json, os, re, shutil, socket, subprocess, tempfile, threading, time
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
HEAD_ING = re.compile(r'^\s*(?:#+\s*)?(sk[łl]adniki|ingredients?|potrzebujesz|you(?:\'| wi)ll need|na (?:\d+ )?porcj\w+|do przepisu)\b.*?:?\s*$', re.I)
HEAD_STEP = re.compile(r'^\s*(?:#+\s*)?(przygotowanie|spos[óo]b (?:przygotowania|wykonania)|wykonanie|kroki|instrukcja|instructions?|directions?|method|steps?|jak zrobi[ćc])\b.*?:?\s*$', re.I)


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
    return {'name': rest.strip(' ,.') or s, 'qty': qty, 'unit': unit}


def split_sections(text):
    lines = [l.rstrip() for l in text.replace('\r', '').split('\n')]
    ing, steps, other, mode = [], [], [], None
    for l in lines:
        if not l.strip():
            continue
        if HEAD_ING.match(l):
            mode = 'i'
            continue
        if HEAD_STEP.match(l):
            mode = 's'
            continue
        (ing if mode == 'i' else steps if mode == 's' else other).append(l)
    if not ing and not steps:
        ing_like = [l for l in other if re.match(r'^\s*(?:[-•*·▪►✔✅👉🔸🔹●○]\s*)?(?:\d+(?:[.,/]\d+)?|[½¼¾⅓⅔⅛])\s*(?:[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż.]+)\b', l)
                    and len(l) < 90]
        if len(ing_like) >= 3:
            ing = ing_like
            steps = [l for l in other if l not in ing_like and len(l) > 30]
            other = [l for l in other if l not in ing_like and l not in steps]
    return other, ing, steps


def heuristic(text, title=''):
    other, ing, steps = split_sections(text)
    items = [x for x in (parse_ing_line(l) for l in ing) if x]
    st = []
    for l in steps:
        l = re.sub(r'^\s*(?:krok\s*)?\d+\s*[.):-]\s*', '', l, flags=re.I)
        l = re.sub(r'^[\s\-•*·▪►✔✅👉🔸🔹●○]+', '', l).strip()
        if l and not re.match(r'^\d+\s*(?:porcj\w*|osób|min\w*)\b[^.]{0,20}$', l, re.I):
            st.append(l)
    if len(items) < 2 or len(st) < 1:
        return None
    ttl = title or (other[0][:80] if other else 'Przepis z linku')
    summ = ' '.join(o for o in other[1:3])[:240] if len(other) > 1 else ''
    meta_txt = '\n'.join(other + [l for l in steps if len(l) < 40])
    mm = re.search(r'(\d+)\s*(?:min|minut)', meta_txt, re.I)
    sv = re.search(r'(?:porcj\w*|osób|os\.|serves|servings?)\D{0,3}(\d+)|(\d+)\s*(?:porcj|osób|servings)', meta_txt, re.I)
    return {
        'title': ttl.strip(' #*-'), 'summary': summ, 'category': 'obiad', 'minutes': int(mm.group(1)) if mm else 30, 'difficulty': 2,
        'servings': int((sv.group(1) or sv.group(2))) if sv else 2, 'cuisine': '', 'tags': [], 'ingredients': items, 'steps': st, 'tip': None,
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
- minutes: łączny czas z materiału; jeśli go nie ma, oszacuj rozsądnie. difficulty: 1 (bardzo łatwe) do 4 (trudne). servings: liczba porcji z materiału, a gdy brak, oszacuj.
- category wybierz z listy. tags tylko z: %(tags)s (tylko jeśli naprawdę pasują).
- summary: jedno lub dwa zdania opisu dania. cuisine: np. polska, włoska, azjatycka.
- tip: jedna praktyczna wskazówka z materiału albo null.
- dish_time: tylko gdy materiałem jest film – sekunda filmu, w której najlepiej widać gotowe, podane danie (ładne ujęcie z bliska, bez rąk i napisów, jeśli się da); w innym przypadku null.
- Jeśli w materiale NIE MA przepisu (brak składników lub sposobu wykonania), zwróć {"found": false}.

MATERIAŁ (%(kind)s):
"""


def gemini_call(contents_parts, schema=True, tools=None, temperature=0.15, timeout=120):
    """Jedno wywołanie Gemini z kolejnymi modelami na liście. Zwraca (dict albo tekst, cała odpowiedź)."""
    if not GEMINI_KEY:
        raise Fail('no_key', 'Serwer nie ma klucza Gemini.')
    cfg = {'temperature': temperature}
    if schema:
        cfg.update({'responseMimeType': 'application/json', 'responseSchema': SCHEMA})
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


def gemini(parts, kind):
    head = PROMPT % {'units': ', '.join(UNITS), 'tags': ', '.join(TAGS), 'kind': kind}
    return gemini_call([{'text': head}] + parts)[0]


# ───────────────────────── film ─────────────────────────
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


def author_comments(url, info):
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
                                  '--write-comments', '--extractor-args', 'youtube:max_comments=60,all,0,0;comment_sort=top', url],
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
        info = ytdlp_info(url)
        if info:
            caption = (info.get('description') or '').strip()
            title = (info.get('title') or '').strip()
            dur = info.get('duration')
            thumbs = video_thumbs(info)
        if not caption or not thumbs:
            try:
                htm = http_get(url, ua='facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)', limit=800_000)
                caption = caption or meta(htm, 'og:description', 'description')
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
        if recipe_like(caption) or (GEMINI_KEY and 'KOMENTARZ AUTORA' in caption and len(caption) > 150):
            r = structure((title + '\n' + caption).strip(), kind, url, 'opis')
            if r:
                return with_image(r, thumbs)
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
        if info is not None or 'tiktok' in host or 'instagram' in host or 'youtube' in host or 'youtu.be' in host or 'facebook' in host or 'fb.' in host:
            if GEMINI_KEY:
                media = download_media(url, dur)
                if media:
                    mime, data = media
                    ctx = (title + '\n' + caption).strip()
                    parts = [{'inline_data': {'mime_type': mime, 'data': base64.b64encode(data).decode()}}]
                    if ctx:
                        parts.append({'text': 'Opis posta i komentarze autora (mogą być niepełne):\n' + ctx[:8000]})
                    g = gemini(parts, 'film (obraz, napisy na ekranie i mowa)' if mime.startswith('video') else 'nagranie dźwięku z filmu')
                    if g.get('found'):
                        n = norm_recipe(g, url, 'film+gemini')
                        if valid(n):
                            return with_image(n, thumbs, video_frame(mime, data, g.get('dish_time')) if not thumbs else None)
        raise Fail('no_recipe', 'Nie znalazłem przepisu w tym poście. Skopiuj opis posta i wklej go w zakładce „Wklej tekst”.')
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


# ───────────────────────── HTTP ─────────────────────────
class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def cors(self):
        o = self.headers.get('Origin', '')
        if o in ALLOW_ORIGINS or (o.startswith('http://localhost') and 'localhost' in ''.join(ALLOW_ORIGINS + ['localhost'])):
            self.send_header('Access-Control-Allow-Origin', o)
            self.send_header('Vary', 'Origin')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type')
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
        if urllib.parse.urlparse(self.path).path in ('/health', '/zdrowie'):
            return self.send(200, {'ok': True, 'v': 3, 'features': ['komentarze', 'zdjecia', 'lodowka', 'zdjecie-dania'], 'gemini': bool(GEMINI_KEY), 'ytdlp': bool(shutil.which(YTDLP) or os.path.exists(YTDLP)), 'ffmpeg': bool(shutil.which('ffmpeg'))})
        self.send(404, {'ok': False, 'error': 'nie znaleziono'})

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
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
            self.send(422 if e.code in ('no_recipe', 'empty', 'bad_url', 'size') else 502, {'ok': False, 'code': e.code, 'error': e.msg})
        except Exception as e:
            self.send(500, {'ok': False, 'code': 'internal', 'error': 'Błąd serwera (%s).' % type(e).__name__})
        finally:
            lock.release()


if __name__ == '__main__':
    print('kucharz-import na 127.0.0.1:%d, Gemini: %s' % (PORT, 'tak' if GEMINI_KEY else 'nie'), flush=True)
    ThreadingHTTPServer(('127.0.0.1', PORT), H).serve_forever()
