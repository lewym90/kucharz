#!/usr/bin/env python3
"""Buduje paczki danych PWA z recipes-own.json.
Użycie: python3 tools/build_data.py [ścieżka/recipes-own.json]
Wynik: public/data/index.json (lekki indeks), public/data/<kategoria>.json (pełne przepisy), public/data/ingredients.json (katalog składników)."""
import json, re, sys, os, unicodedata, collections
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', 'data-src', 'recipes-own.json')
OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'data')
os.makedirs(OUT, exist_ok=True)

ADJ = set('świeży świeża świeże świeżo drobno posiekany posiekana posiekane posiekanej mielony mielona mielone duży duża duże mały mała małe średni średnia średnie gotowany gotowana gotowane ugotowany ugotowana ugotowane dojrzały dojrzała dojrzałe twardy miękki miękka zimny zimna zimne ciepły ciepła ciepłe gorący gorąca gorące pokrojony pokrojona pokrojone starty starta starte tarty tarta tarte w kostkę kostkę kostka plasterkach plasterki plasterkami półplasterkach półplasterki cienkie cienkich cienkie grubo drobny drobna drobne rozmiar rozmiaru dobrej jakości opalona opalony najlepiej plus około ok bardzo dobrze mocno odsączone odsączona odsączony wypestkowane wypestkowany obrane obrany umyte pokruszona pokruszone rozmrożone mrożone mrożony mrożona cienko krojone krojona krojony świeżej'.split())
CONT = set('sok skórka skórki proszek soda'.split())
STOP = set('z ze do na w i oraz lub albo bez dla po od'.split())
SUF = ['ami', 'ach', 'ów', 'om', 'ek', 'ka', 'ko', 'ki', 'ku', 'ie', 'ę', 'ą', 'a', 'e', 'y', 'i', 'o', 'u']

def fold(s):
    return unicodedata.normalize('NFKD', s.replace('ł', 'l').replace('Ł', 'L')).encode('ascii', 'ignore').decode().lower()

def stem(tok):
    t = fold(tok)
    for s in SUF:
        if t.endswith(s) and len(t) - len(s) >= 4:
            return t[:-len(s)]
    return t

def clean(name):
    n = name.lower()
    n = re.sub(r'\(.*?\)', ' ', n)
    n = n.split(',')[0]
    n = re.split(r'\blub\b|\balbo\b', n)[0]
    return n.strip()

def label_and_key(name):
    n = clean(name)
    toks = re.findall(r'[a-ząćęłńóśźż]+', n)
    cut = []
    for t in toks:
        if t in STOP and cut and not (cut[0] in CONT and len(cut) == 1):
            break
        if t in STOP and cut:
            continue
        if t in ADJ or t in STOP:
            continue
        cut.append(t)
    cut = cut[:2] if cut else toks[:1]
    if not cut:
        return n or name, fold(name)
    label = ' '.join(cut)
    key = ' '.join(stem(t) for t in cut)
    return label, key

STAPLES = {'sol', 'pieprz', 'woda', 'olej', 'oliw', 'cukier', 'mak'}
raw = json.load(open(SRC, encoding='utf-8'))
labels = collections.defaultdict(collections.Counter)
counts = collections.Counter()
for r in raw:
    seen = set()
    for i in r['ingredients']:
        lab, key = label_and_key(i['name'])
        i['key'] = key
        labels[key][lab] += 1
        if key not in seen:
            counts[key] += 1; seen.add(key)

# kanoniczny skrót: pierwszy token klucza 'sol', 'pieprz'...
def staple(key):
    first = key.split(' ')[0]
    return first in ('sol', 'pieprz', 'woda', 'olej', 'oliwa', 'oliw', 'cukier')

cats = collections.defaultdict(list)
index = []
for r in raw:
    ings = []
    for i in r['ingredients']:
        ings.append({'n': i['name'], 'q': i['qty'], 'u': i['unit'], 'k': i['key']})
    full = {'id': r['id'], 'title': r['title'], 'cat': r['category'], 'min': r['minutes'], 'rest': r.get('rest_minutes', 0),
            'diff': r['difficulty'], 'serv': r['servings'], 'cuisine': r['cuisine'], 'tags': r['tags'],
            'sum': r['summary'], 'ing': ings, 'steps': r['steps'], 'tip': r['tip'], 'src': r['source'], 'lic': r['license']}
    cats[r['category']].append(full)
    required = sorted({i['k'] for i in ings if not staple(i['k']) and i['u'] not in ('do smaku', 'do podania')})
    optional = sorted({i['k'] for i in ings if not staple(i['k']) and i['u'] in ('do podania',)})
    index.append({'id': r['id'], 'title': r['title'], 'cat': r['category'], 'min': r['minutes'], 'rest': r.get('rest_minutes', 0),
                  'diff': r['difficulty'], 'serv': r['servings'], 'cuisine': r['cuisine'], 'tags': r['tags'],
                  'sum': r['summary'], 'req': required, 'opt': optional, 'ni': len(ings),
                  'ingtext': ' '.join(i['n'] for i in ings)})
for c, rs in cats.items():
    json.dump(rs, open(os.path.join(OUT, c + '.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
json.dump(index, open(os.path.join(OUT, 'index.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
cat = [{'k': k, 'l': labels[k].most_common(1)[0][0], 'c': counts[k], 's': 1 if staple(k) else 0} for k in counts]
cat.sort(key=lambda x: -x['c'])
json.dump(cat, open(os.path.join(OUT, 'ingredients.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
meta = {'count': len(raw), 'cats': {c: len(rs) for c, rs in cats.items()}}
json.dump(meta, open(os.path.join(OUT, 'meta.json'), 'w'), ensure_ascii=False)
print(len(raw), 'przepisów;', len(cat), 'składników w katalogu')
print([ (x['l'],x['c']) for x in cat[:25]])
