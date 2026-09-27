import json,glob
st=json.load(open('reports/prospects/onboard-batch-status.json'))
def reasons(sym):
    a=st[sym]['address'].lower(); ds=sorted(glob.glob(f'reports/assessments/{a}/*/'))
    ps=json.load(open(ds[-1]+'proposed-settings.json')); out=set()
    for p in ps.get('pools',[]):
        for r in p.get('candidateGeneration',{}).get('rejected',[]):
            s=r.get('statistics',{}); out.add(f"{r['window']//60}m {r['reason'].replace('Historical staleness exceeds proposal policy','stale '+str(round(s.get('historicalStaleFraction',0)*100))+'%').replace('Measured deviation exceeds proposal policy','deviation p95 '+str(round(s.get('deviationP95Bps',0)))+' bps').replace('Current liquidity is below the observed-range floor','liquidity below floor')}")
    return sorted(out)
p='reports/prospects/.sheet-new.tsv'; lines=open(p,encoding='utf-8').read().splitlines(); out=[]
for l in lines:
    if not l.strip(): continue
    c=l.split('\t')
    if c[10].startswith('BLOCKED') or 'No candidate completed' in c[10]:
        rs='; '.join(reasons(c[0])) or 'candidate settings failed the fork checks (see reports/prospects/logs)'
        c[10]="NOT PASSED as TWAP - "+rs; c[13]="NOT RECOMMENDED (TWAP checks failed)"
    out.append('\t'.join(c))
open(p,'w',encoding='utf-8').write('\n'.join(out))
for l in out: c=l.split('\t'); print(c[0],'|',c[7],'|',c[10][:120],'|',c[13])
