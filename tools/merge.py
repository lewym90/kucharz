import json,subprocess,sys
sys.path.insert(0,'/home/claude/gen')
from post import post
dirs=['own','obiady','zupy','makarony','kolacje','salatki','przekaski','ciasta','desery','napoje','sosy']
allr=[]
import os
for d in dirs:
    p=f'/home/claude/work/{d}'
    if not os.path.isdir(p): continue
    subprocess.run(['python3','-I','/home/claude/gen/parse.py',p,f'/tmp/m_{d}.json'],capture_output=True)
    allr+=json.load(open(f'/tmp/m_{d}.json'))
allr=[post(r) for r in allr]
ids=[r['id'] for r in allr]
dup=[i for i in set(ids) if ids.count(i)>1]
print('total',len(allr),'dups',dup)
json.dump(allr,open('/home/claude/out/recipes-own.json','w'),ensure_ascii=False,indent=1)
from collections import Counter
print(Counter(r['category'] for r in allr), 'signature',sum('signature' in r['tags'] for r in allr))
