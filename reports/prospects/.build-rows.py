import json,glob,subprocess
rows=json.loads(subprocess.run(['node','scripts/onboarding/batch-summary.mjs'],capture_output=True,text=True).stdout)
ledger=json.load(open('reports/prospects/sheet-written.json'))
pr={r['address'].lower():r for r in json.load(open(sorted(glob.glob('reports/prospects/prospects-*.json'))[-1]))['rows']}
def settings(r):
    a=r['address'].lower(); d=sorted(glob.glob(f'reports/assessments/{a}/*/'))[-1]
    ps=json.load(open(d+'proposed-settings.json')); return ps,(ps.get('recommendedSetting') or {})
today='2026-09-24'
def clean(e):
    return e.replace('error (return data: 0x7c9c6e8f000000000000000000000000000000)','pool price at limit').replace('error (return data: 0x8b063d73000000000000000000000000000000)','too little received')
lines=[]
for r in rows:
    sym=r['symbol']
    if sym in ledger['batchWritten'] or sym in ledger['rows']: continue
    p=pr[r['address'].lower()]; ps,rs=settings(r); prm=rs.get('params',{}); route=prm.get('route')
    depth=r.get('v3UsdgInPool') or 0
    cl='YES' if p['chainlinkFeed'] else 'NO'
    if route and route['venue']=='v4':
        ver='v4'; pool=f"v4 key: USDG/{sym} fee {route['fee']} tickSpacing {route['tickSpacing']} hookless (V1's route); v3 pool {p['v3Pool']} ({p['v3Fee']}) also exists"; fee=route['fee']/10000; link=''
    elif route and route['venue']=='v3':
        ver='v3'; pool=route.get('pool') or p['v3Pool']; fee=route['fee']/10000; link=f"https://app.uniswap.org/explore/pools/robinhood/{pool}"
    else:
        ver='v3'; pool=rs.get('pool') or p['v3Pool'] or ''; fee=(rs.get('fee') or p['v3Fee'] or 0)/10000; link=f"https://app.uniswap.org/explore/pools/robinhood/{pool}" if pool else ''
    rt=rs.get('passedRoundTripSizesUsdg') or []
    rts='/'.join('10k' if x==10000 else '1k' if x==1000 else str(x) for x in rt)
    oracle=1.0; 
    if r['state']=='done' and rs.get('oracleType')=='CHAINLINK':
        k=f"PASSED (Chainlink path, {route['venue']} route) - round trips {rts}"+("; 10k reverts" if 10000 not in rt else '')
        l=f"Chainlink feed {prm['feed']}, maxStaleness {round(prm['maxStaleness']/3600)}h, slippage {prm['slippageBps']} bps, {route['venue']} route fee {route['fee']}"
        n=("ON V1 - " if p['onV1'] else '')+"READY TO REGISTER on V2 (needs Dan approval)"
    elif r['state']=='done' and prm.get('twapWindow'):
        oracle=0.75
        pol=ps.get('pools',[{}])[0].get('candidateGeneration',{}).get('policy',{}) if ps.get('pools') else {}
        over=[]
        if pol.get('deviationCeilingOverridden'): over.append('deviation override')
        if pol.get('liquidityFloorOverridden'): over.append('floor override')
        k=f"PASSED as TWAP ({str(prm['twapWindow']//3600)+'h' if prm['twapWindow']>=3600 else str(prm['twapWindow']//60)+'m'} window, {prm['maxDeviationBps']} bps) - round trips {rts}"+(" ("+', '.join(over)+")" if over else '')+("; has Chainlink feed" if p['chainlinkFeed'] else '')
        l=f"window {prm['twapWindow']}s, maxObsAge {prm['maxObservationAge']}s, maxDeviation {prm['maxDeviationBps']} bps, slippage {prm['slippageBps']} bps, liquidity floor {int(prm['minHarmonicLiquidity'])/1e18:.3g}e18"
        n="READY TO REGISTER on V2 as TWAP (needs Dan approval)"
    elif r['state']=='done':
        oracle=0.75
        rej=[]
        for pool_ in ps.get('pools',[]):
            for x in pool_.get('candidateGeneration',{}).get('rejected',[]): rej.append(f"{x.get('window')}s: {x.get('reason')}")
        k=f"NOT PASSED as TWAP - {r.get('reason') or r.get('result')}"+(" ["+'; '.join(sorted(set(rej))[:3])+"]" if rej else '')
        l='-'; n="NOT RECOMMENDED (TWAP checks failed)"+("; re-assess on Chainlink path" if p['chainlinkFeed'] else '')
    else:
        errs=(r.get('errors') or [''])
        k=f"BLOCKED - {clean(errs[0])[-80:].strip() if errs and errs[0] else (r.get('reason') or 'run failed')}"+(" - retry on V3 pool pending" if route is None and p['chainlinkFeed'] else '')
        l='-'; n="RETRY ON V3 POOL PENDING" if p['chainlinkFeed'] else "BLOCKED - inspect log"
    cap=f"formula ~${int(depth*0.2*oracle*0.5):,} (V3 depth ${depth:,} x 0.2 x {oracle:g} x 0.5)" if depth else '-'
    row=[sym,cl,'USDG',ver,pool,r['address'],'',f"{depth:,} (v3 USDG)",f"{fee:g}",link,k,l,cap,n,f"assessment {today} (batch)"]
    row=[str(c).replace('\t',' ').replace('\n',' ') for c in row]
    lines.append(row)
tsv='\n'.join('\t'.join(x) for x in lines)
open('reports/prospects/.sheet-new.tsv','w',encoding='utf-8').write(tsv)
print(len(lines),'new rows:',[x[0] for x in lines])
