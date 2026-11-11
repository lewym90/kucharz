import re,sys
sys.path.insert(0,'/home/claude/gen')
from tags import classify
REST=r'lodówk|studź|mroź|odstaw|zostaw|marynuj|schłodź|schładzaj|lodówc|zamroź|zamrażark|namocz|wyrasta|rośnie|odpoczyw|odpocznie|stygnie|ostudź|ostygnie|dojrzewa|fermentuj|moczy|zastyg|stężeje|stężenia|chłodź|wyrośnie|napęcznie|zagęści się w lodówce'
ACTIVE=r'piecz|gotuj|smaż|duś|zapiekaj|grilluj|podsmaż|blanszuj|zagotuj|zredukuj|podgrzewaj|mieszaj|ubijaj|miksuj|ugotuj'
def mins_in(s):
    tot=0
    for m in re.finditer(r'(\d+)(?:[–-](\d+))?\s*(minut|min\b|godzin|godz\b)',s):
        v=int(m.group(2) or m.group(1)); tot+=v*(60 if m.group(3).startswith('godz') else 1)
    return tot
def post(r):
    tg=[t for t in r['tags']]
    meat,an,gl=classify(r)
    s=set(tg)
    if meat: s-= {'wegetariańskie','wegańskie'}
    else: s.add('wegetariańskie')
    if an: s.discard('wegańskie')
    elif not meat: s.add('wegańskie')
    if gl: s.discard('bezglutenowe')
    r['tags']=[t for t in tg if t in s]+[t for t in sorted(s) if t not in tg]
    rest=0
    for st in r['steps']:
        l=st.lower()
        if re.search(REST,l):
            m=mins_in(l)
            if re.search(r'całą noc|na noc|przez noc|do rana|na noc',l) and m<300: m=max(m,480)
            if m and not (re.search(ACTIVE,l) and not re.search(r'odstaw|zostaw|marynuj|schłodź|lodówc|namocz|ostudź|zamroź',l)): rest+=m
    r['rest_minutes']=rest
    return r

OVEN=r'\b(?:piecz|podpiecz|zapiecz|upiecz|dopiecz|dopiekaj|zapiekaj|podpiekaj|opiekaj|opiecz|zrumień|wstaw do piekarnika|włóż do piekarnika)\b|w piekarniku'
def fix_steps(r):
    st=r['steps']
    full=' '.join(st).lower()
    if not re.search(r'nagrz|rozgrzej piekarnik|rozgrzany piekarnik|nagrzan|włącz piekarnik',full):
        for i,s in enumerate(st):
            l=s.lower()
            m=re.search(r'(\d{3})\s*°\s*c',l)
            if m and re.search(OVEN,l) and not re.search(r'olej|frytur|tłuszcz do',l):
                st[i]='Piekarnik nagrzej do %s°C. %s'%(m.group(1),s); break
    for i,s in enumerate(st):
        if re.search(r'smaż|duś|gotuj|podsmaż|grill',s.lower()):
            s=re.sub(r'\bupieczon(y|a|e|ych)\b',lambda m:{'y':'usmażony','a':'usmażona','e':'usmażone','ych':'usmażonych'}[m.group(1)],s)
            st[i]=s
    return r
_post_old=post
def post(r):
    return fix_steps(_post_old(r))

def fix_temp_change(r):
    st=r['steps']
    m0=None
    for s in st:
        m0=re.match(r'Piekarnik nagrzej do (\d{3})°C\.',s)
        if m0: break
    if m0:
        t0=m0.group(1)
        for i,s in enumerate(st):
            m=re.match(r'Piecz w (\d{3})°C przez',s)
            if m and m.group(1)!=t0:
                st[i]=re.sub(r'^Piecz w (\d{3})°C przez',r'Ustaw piekarnik na \1°C i piecz przez',s,count=1)
    return r
_post_old2=post
def post(r):
    return fix_temp_change(_post_old2(r))

PAD=[r',? aż (?:będą|będzie) (?:wielkości|długości) [^.,;]+', r',? aż uzyskasz równe kawałki', r',? aż zostaną same równe kawałki', r',? aż będą nierówne', r',? aż będzie widoczny', r',? aż masa się skończy']
def fix_pad(r):
    for i,s in enumerate(r['steps']):
        for p in PAD: s=re.sub(p,'',s)
        r['steps'][i]=s
    return r
_post_old3=post
def post(r):
    return fix_pad(_post_old3(r))
