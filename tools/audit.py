import json,re,collections,sys,difflib
d=json.load(open('/home/claude/out/recipes-own.json'))
MEAT='kurczak|indyk|kacz|wołowin|wieprzow|schab|boczek|szynk|kiełbas|chorizo|salami|mięso mielone|mielone|cielęc|jagnię|baranin|polędwic|żeberk|karkówk|łopatk|stek|pancetta|guanciale|prosciutto|wędlin|szynka|gęś|królik|boczk|wątrob|mortadel|salceson|kabanos|parówk|krewetk|łosoś|dorsz|tuńczyk|śledź|sardyn|anchois|makrel|pstrąg|ryb|owoce morza|małże|kalmar|ośmiorn|krab|homar|sandacz|karp|halibut|mintaj|morszczuk|tilapi|okoń|szczupak|węgorz|ikra|kawior|rosół|bulion (drobiowy|wołowy|mięsny)|smalec|słonina|salceson|mięs'
EGGDAIRY='jajk|jajo|żółtk|białk|mleko(?! kokos| owsian| migdał| sojow| ryżow| roślin)|śmietan|masło(?! orzech| z orzech| migdał| kakao| shea)|ser |sery |serek|parmezan|mozzarell|feta|gorgonzol|ricotta|mascarpone|jogurt(?! kokos| sojow)|maślank|kefir|twaróg|cheddar|pecorino|halloumi|śmietank|kajmak|krem 30|lody'
VEG_NOT_VEGAN='miód|żelatyn|jajk|jajo|żółtk|białk|mleko(?! kokos| owsian| migdał| sojow| ryżow| roślin)|śmietan|masło(?! orzech| z orzech| migdał| kakao)|ser |serek|parmezan|mozzarell|feta|gorgonzol|ricotta|mascarpone|jogurt(?! kokos| sojow| roślin)|maślank|kefir|twaróg|cheddar|pecorino|halloumi|śmietank|kajmak|majonez|lody|czekolada mleczna|czekolada biała|sos worcester|ser'
GLUTEN='mąk|makaron|spaghetti|penne|tagliatelle|fusilli|lasagne|chleb|bułk|bagiet|panko|bułka tarta|tortill|pita|naan|kuskus|bulgur|kasza (jęczmienna|manna|pęczak)|pęczak|jęczmie|płatki owsiane|owsiane|sos sojowy|piwo|seitan|kluski|pierogi|ciasto francuskie|ciasto filo|herbatnik|biszkopt|ciastka|grzank|croutons|krakers|gnocchi|ramen|udon|soba|miso|ciasto drożdżowe|drożdże|piernik|wafl|owsianka|granola|musli|pszenn|żytni|orkisz'
issues=collections.defaultdict(list)
def txt(r): return ' '.join(i['name'] for i in r['ingredients']).lower()
for r in d:
    t=txt(r); tg=set(r['tags']); full=t
    if ('wegetariańskie' in tg or 'wegańskie' in tg) and re.search(MEAT,t): issues['wege+mieso'].append((r['id'],re.search(MEAT,t).group(0)))
    if 'wegańskie' in tg and re.search(VEG_NOT_VEGAN,t): issues['wegan+nabial/jajko/miod'].append((r['id'],re.search(VEG_NOT_VEGAN,t).group(0)))
    if 'wegańskie' in tg and 'wegetariańskie' not in tg: issues['wegan bez wege'].append(r['id'])
    if 'bezglutenowe' in tg and re.search(GLUTEN,t): issues['bezgluten+gluten'].append((r['id'],re.search(GLUTEN,t).group(0)))
    if not ('wegetariańskie' in tg) and not re.search(MEAT,t) and r['category'] not in ('x',): issues['brak wege a bez miesa'].append(r['id'])
    # time
    if r['minutes']<=0 or r['minutes']>600: issues['czas dziwny'].append((r['id'],r['minutes']))
    steps=' '.join(r['steps']).lower()
    mins=0
    for m in re.finditer(r'(\d+)(?:[–-](\d+))?\s*(minut|min\b|godzin|godz\b)',steps):
        v=int(m.group(2) or m.group(1)); mins+= v*(60 if m.group(3).startswith('godz') else 1)
    r['_stepmin']=mins
    if r['minutes']>0 and mins>r['minutes']*3+30 and r['category'] not in ('ciasto','deser'): issues['czas<<kroki'].append((r['id'],r['minutes'],mins))
    if mins>0 and r['minutes']*1.0<mins*0.5 and r['category'] not in ('ciasto','deser','napoj','sos'): issues['czas za maly vs kroki'].append((r['id'],r['minutes'],mins))
    # qty outliers
    for i in r['ingredients']:
        n=i['name'].lower(); q=i['qty']; u=i['unit']
        if q and u=='g' and re.search(r'^(sól|pieprz|cukier puder|soda|proszek)',n) and q>20: issues['ilosc dziwna'].append((r['id'],n,q,u))
        if q and u=='łyżka' and q>10: issues['ilosc dziwna'].append((r['id'],n,q,u))
        if q and u=='łyżeczka' and q>8: issues['ilosc dziwna'].append((r['id'],n,q,u))
        if q and u=='szczypta' and q>3: issues['ilosc dziwna'].append((r['id'],n,q,u))
        if q is None and u not in ('do smaku','do podania',None): issues['qty none'].append((r['id'],n,u))
    if r['servings']<1 or r['servings']>24: issues['porcje'].append((r['id'],r['servings']))
    if not r['tip']: issues['brak tip'].append(r['id'])
    # ingredient never used
    for i in r['ingredients']:
        w=[x for x in re.findall(r'[a-ząćęłńóśźż]{4,}',i['name'].lower()) if x not in ('świeży','świeża','świeże','drobno','posiekany','posiekana','mielony','mielona','suszony','suszone','duży','duża','mały','mała','średni','gotowany','białe','czarny','czarna','zielona','zielony','czerwona','czerwony','naturalny','naturalna','łyżka','pokrojony','pokrojone','starty','tarty','dojrzałe','dojrzały','rozmiar','do')]
        if w and not any(x[:max(4,len(x)-3)] in steps for x in w) and i['unit'] not in ('do podania',): issues['skladnik nieuzyty w krokach'].append((r['id'],i['name']))
for k,v in issues.items(): print(k,len(v),v[:6])
json.dump({k:v for k,v in issues.items()},open('/tmp/issues.json','w'),ensure_ascii=False)
# repeated sentences
c=collections.Counter()
for r in d:
    for s in r['steps']: c[s]+=1
print('POWT ZDANIA',[(s,n) for s,n in c.most_common(15) if n>2])
c2=collections.Counter()
for r in d:
    for s in r['steps']:
        for sent in re.split(r'(?<=[.!?])\s+',s):
            if len(sent)>25: c2[sent]+=1
print('POWT FRAZY',[(s[:70],n) for s,n in c2.most_common(25) if n>4])
tips=collections.Counter(r['tip'] for r in d)
print('POWT TIPY',[(s[:70],n) for s,n in tips.most_common(15) if n>2])
# near-dup titles
tit=[(r['id'],r['title']) for r in d]
nd=[]
for i in range(len(tit)):
    for j in range(i+1,len(tit)):
        if difflib.SequenceMatcher(None,tit[i][1].lower(),tit[j][1].lower()).ratio()>0.88: nd.append((tit[i][1],tit[j][1]))
print('PODOBNE TYTULY',len(nd),nd[:40])
