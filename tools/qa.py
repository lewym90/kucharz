import sys, json, re, unicodedata
def fold(s): return unicodedata.normalize('NFKD',s.replace('ł','l').replace('Ł','L')).encode('ascii','ignore').decode().lower()
rs=json.load(open(sys.argv[1],encoding='utf-8'))
only=sys.argv[2] if len(sys.argv)>2 else None
bad=0
for r in rs:
    if only and r['category']!=only: continue
    e=[]
    if len(r['summary'])<80: e.append('opis<80')
    if not r['tip']: e.append('brak wskazowki')
    if len(r['steps'])<4: e.append('<4 kroki')
    smin=30 if r['category'] in ('napoj','sos') else 45
    if any(len(s)<smin for s in r['steps']): e.append('krotki krok')
    cues=sum(1 for s in r['steps'] if re.search(r'\d|az |gdy |kiedy ',fold(s)))
    cmin=max(1,len(r['steps'])//3) if r['category'] in ('napoj','sos') else max(2,len(r['steps'])//2)
    if cues< cmin: e.append('malo wskazowek czasu/wygladu')
    if len(r['ingredients'])<4: e.append('<4 skladniki')
    names=' '.join(fold(i['name']) for i in r['ingredients'])
    for i in r['ingredients']:
        if i['qty'] is None and not i['unit']: e.append('skladnik bez ilosci: '+i['name'])
    st=fold(' '.join(r['steps']))
    for stem,label in [('sol','sol'),('pieprz','pieprz'),('olej','olej'),('oliw','oliwa'),('mask','maslo'),('masl','maslo'),('cukr','cukier'),('mlek','mleko'),('woda','woda'),('wod','woda')]:
        pass
    chk=[(r'\bsol\w*|posol\w*|dopraw\w*','sol|przypraw'),(r'pieprz\w*','pieprz'),(r'oliw\w*','oliw'),(r'\bolej\w*','olej'),(r'\bmasl\w*|\bmasle\b','mas'),(r'cukr\w*|cukier','cuk'),(r'miod\w*','miod'),(r'jajk\w*|jajo|zoltk|bialk','jajk|zoltk|bialk'),(r'mlek\w*','mlek'),(r'mak\w+\b','mak')]
    for pat,need in chk:
        if re.search(pat,st) and not re.search(need,names):
            if pat.startswith('mak'): continue
            e.append('uzyty w kroku, brak na liscie: '+need.split('|')[0])
    if e: bad+=1; print(r['id'],'|',', '.join(sorted(set(e))))
n=len([r for r in rs if not only or r['category']==only])
print('PRZEPISOW',n,'Z BLEDAMI',bad)
