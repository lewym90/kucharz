import sys, re, json, glob, unicodedata
from fractions import Fraction
def slug(s):
    s=unicodedata.normalize('NFKD',s.replace('ł','l').replace('Ł','L')).encode('ascii','ignore').decode().lower()
    return re.sub(r'[^a-z0-9]+','-',s).strip('-')
def qty(txt):
    t=txt.strip()
    if t in ('-',''): return None,None
    m=re.match(r'^(\d+\s+\d+/\d+|\d+/\d+|\d+(?:[.,]\d+)?)\s*(.*)$',t)
    if not m: return None,t
    n=m.group(1).replace(',','.')
    if '/' in n:
        parts=n.split(); v=sum(Fraction(p) for p in parts); v=float(v)
    else: v=float(n)
    return v,(m.group(2) or None)
UN={'łyżki':'łyżka','łyżek':'łyżka','łyżeczki':'łyżeczka','łyżeczek':'łyżeczka','ząbki':'ząbek','ząbków':'ząbek','kromki':'kromka','kromek':'kromka','plastry':'plaster','plasterki':'plaster','plasterek':'plaster','plastrów':'plaster','plasterków':'plaster','listków':'listek','listki':'listek','liście':'liść','gałązki':'gałązka','łodygi':'łodyga','puszki':'puszka','gałki':'gałka','gałek':'gałka','główki':'główka','garście':'garść','pęczki':'pęczek','kawałki':'kawałek','arkusze':'arkusz','opakowania':'opakowanie','porcje':'porcja','torebki':'torebka','kostek':'kostka','pęczka':'pęczek','listek':'liść'}
out=[]; errs=[]
for f in sorted(glob.glob(sys.argv[1]+'/*.txt')):
    cur=None
    for ln in open(f,encoding='utf-8').read().split('\n'):
        if ln.startswith('# '):
            if cur: out.append(cur)
            p=[x.strip() for x in ln[2:].split('|')]
            if len(p)<7: errs.append(('header',ln)); cur=None; continue
            cur={'title':p[0],'category':p[1],'minutes':int(p[2]),'difficulty':int(p[3]),'servings':int(p[4]),'cuisine':p[5],'tags':[t for t in p[6].split(',') if t],'summary':'','ingredients':[],'steps':[],'tip':None,'source':'Własny przepis (Książka Kucharska)','license':'własny'}
            cur['id']='own:'+slug(p[0])
        elif cur is None: continue
        elif ln.startswith('- '):
            a,n=ln[2:].split('|',1) if '|' in ln else (ln[2:],'')
            q,u=qty(a); u=UN.get(u,u); cur['ingredients'].append({'name':n.strip(),'qty':q,'unit':u})
        elif ln.startswith('> '): cur['steps'].append(ln[2:].strip())
        elif ln.startswith('~ '): cur['tip']=ln[2:].strip()
        elif ln.strip(): cur['summary']=(cur['summary']+' '+ln.strip()).strip()
    if cur: out.append(cur)
ids=[r['id'] for r in out]
for r in out:
    if not r['ingredients'] or len(r['steps'])<2: errs.append(('thin',r['title']))
    if any(i['name']=='' for i in r['ingredients']): errs.append(('noname',r['title']))
if len(ids)!=len(set(ids)): errs.append(('dup',''))
json.dump(out,open(sys.argv[2],'w',encoding='utf-8'),ensure_ascii=False,indent=1)
print(len(out),'recipes; errors:',errs)
