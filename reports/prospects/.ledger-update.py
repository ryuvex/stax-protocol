import json
L=json.load(open('reports/prospects/sheet-written.json'))
syms=[l.split('\t')[0] for l in open('reports/prospects/.sheet-new.tsv',encoding='utf-8').read().splitlines() if l.strip()]
row=L['nextFreeRow']
for s in syms: L['rows'][s]=row; row+=1
L['nextFreeRow']=row; L['batchWritten']=sorted(set(L['batchWritten'])|set(syms))
json.dump(L,open('reports/prospects/sheet-written.json','w'),indent=2)
print('written',syms,'next free row',row)
