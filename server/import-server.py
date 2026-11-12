#!/usr/bin/env python3
"""Książka Kucharska: import przepisu z linku (strona, Instagram, TikTok, Facebook, YouTube) lub z wklejonego tekstu.

POST /import   {"url": "..."}  albo  {"text": "..."}   ->  {"ok": true, "recipe": {...}, "how": "..."}
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
- Jeśli w materiale NIE MA przepisu (brak składników lub sposobu wykonania), zwróć {"found": false}.

MATERIAŁ (%(kind)s):
"""


def gemini(parts, kind):
    if not GEMINI_KEY:
        raise Fail('no_key', 'Serwer nie ma klucza Gemini.')
    body = {
        'contents': [{'parts': [{'text': PROMPT % {'units': ', '.join(UNITS), 'tags': ', '.join(TAGS), 'kind': kind}}] + parts}],
        'generationConfig': {'responseMimeType': 'application/json', 'responseSchema': SCHEMA, 'temperature': 0.15},
    }
    last = None
    for model in MODELS:
        url = '%s/models/%s:generateContent' % (GEMINI_BASE, model)
        req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_KEY})
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                data = json.loads(r.read())
            txt = data['candidates'][0]['content']['parts'][0]['text']
            return json.loads(txt)
        except urllib.error.HTTPError as e:
            last = 'HTTP %s' % e.code
            if e.code in (429, 500, 503, 404):
                continue
            break
        except Exception as e:
            last = type(e).__name__
            continue
    raise Fail('gemini', 'Gemini nie odpowiedział (%s).' % last)


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
    if social:
        info = ytdlp_info(url)
        if info:
            caption = (info.get('description') or '').strip()
            title = (info.get('title') or '').strip()
            dur = info.get('duration')
        if not caption:
            try:
                htm = http_get(url, ua='facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)', limit=800_000)
                caption = meta(htm, 'og:description', 'description')
                title = title or meta(htm, 'og:title')
            except Fail:
                pass
        caption = html.unescape(caption)
        if recipe_like(caption):
            r = structure((title + '\n' + caption).strip(), 'opis posta pod filmem', url, 'opis')
            if r:
                return r
        # link do pełnego przepisu w opisie
        for lk in re.findall(r'https?://[^\s)>\]]+', caption):
            hh = (urllib.parse.urlparse(lk).hostname or '').lower()
            if hh and not any(s.rstrip('.') in hh for s in SOCIAL) and 'linktr.ee' not in hh:
                try:
                    r = from_page(lk, url)
                    if r:
                        return r
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
                        parts.append({'text': 'Opis posta (może być niepełny):\n' + ctx[:6000]})
                    g = gemini(parts, 'film (obraz, napisy na ekranie i mowa)' if mime.startswith('video') else 'nagranie dźwięku z filmu')
                    if g.get('found'):
                        n = norm_recipe(g, url, 'film+gemini')
                        if valid(n):
                            return n
        raise Fail('no_recipe', 'Nie znalazłem przepisu w tym poście. Skopiuj opis posta i wklej go w zakładce „Wklej tekst”.')
    r = from_page(url, url)
    if r:
        return r
    raise Fail('no_recipe', 'Nie znalazłem na tej stronie przepisu. Skopiuj tekst przepisu i wklej go w zakładce „Wklej tekst”.')


def from_page(page_url, source_url):
    htm = http_get(page_url)
    ld = find_recipe_ld(htm)
    if ld:
        txt, ni, ns = ld_to_text(ld)
        if ni >= 2 and ns >= 1:
            r = structure(txt, 'dane przepisu ze strony', source_url, 'strona')
            if r:
                if not r['title'] or r['title'] == 'Przepis z linku':
                    r['title'] = str(ld.get('name') or r['title'])
                return r
    body = html_to_text(htm)
    if len(body) > 200:
        if GEMINI_KEY:
            t = (meta(htm, 'og:title') + '\n' + body)[:30000]
            return structure(t, 'tekst strony internetowej', source_url, 'strona-tekst')
        h = heuristic(body, meta(htm, 'og:title'))
        if h:
            return norm_recipe(h, source_url, 'strona-reguły')
    return None


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
            return self.send(200, {'ok': True, 'gemini': bool(GEMINI_KEY), 'ytdlp': bool(shutil.which(YTDLP) or os.path.exists(YTDLP)), 'ffmpeg': bool(shutil.which('ffmpeg'))})
        self.send(404, {'ok': False, 'error': 'nie znaleziono'})

    def do_POST(self):
        if urllib.parse.urlparse(self.path).path != '/import':
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
        if n <= 0 or n > 200_000:
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
            r = do_import(body)
            self.send(200, {'ok': True, 'recipe': r, 'how': r.get('how')})
        except Fail as e:
            self.send(422 if e.code in ('no_recipe', 'empty', 'bad_url') else 502, {'ok': False, 'code': e.code, 'error': e.msg})
        except Exception as e:
            self.send(500, {'ok': False, 'code': 'internal', 'error': 'Błąd serwera (%s).' % type(e).__name__})
        finally:
            lock.release()


if __name__ == '__main__':
    print('kucharz-import na 127.0.0.1:%d, Gemini: %s' % (PORT, 'tak' if GEMINI_KEY else 'nie'), flush=True)
    ThreadingHTTPServer(('127.0.0.1', PORT), H).serve_forever()
