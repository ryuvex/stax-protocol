// sanity-check.ts
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

// Known tokenized equity SPL mints & test targets
const CANDIDATES = [
  // POSITIVE CONTROLS (Must return ALIVE)
  { symbol: 'NVDA', mint: 'Xsb4LvV8io2pTz4n4bXz6Rj7U4sK9m...' }, 
  
  // HIGH-VOLUME OUTLIER
  { symbol: 'GME',  mint: '8wXtPeU6557ETkpT22gH5TRK2A8G2FpM8...' },

  // YOUR CANDIDATES HERE...
];

async function checkPools() {
  console.log('🚀 Running Stax v2 Pool Verification...\n');

  for (const token of CANDIDATES) {
    if (token.mint.includes('...')) continue;

    // Test a $1,000 swap quote against USDC via Jupiter API
    const amount = 1000 * 1_000_000;
    const url = `https://quote-api.jup.ag/v6/quote?inputMint=${USDC_MINT}&outputMint=${token.mint}&amount=${amount}&slippageBps=100`;

    try {
      const res = await fetch(url);
      const data = await res.json();

      if (!data.routePlan || data.routePlan.length === 0) {
        console.log(`❌ ${token.symbol}: DEAD (No liquidity routes)`);
        continue;
      }

      const impact = (parseFloat(data.priceImpactPct) * 100).toFixed(2);
      const dexes = data.routePlan.map((r: any) => r.swapInfo.label).join(', ');

      if (parseFloat(impact) > 5.0) {
        console.log(`⚠️ ${token.symbol}: HOLLOW DECOY (Price Impact: ${impact}% | DEX: ${dexes})`);
      } else {
        console.log(`✅ ${token.symbol}: ALIVE (Price Impact: ${impact}% | DEX: ${dexes})`);
      }
    } catch (err) {
      console.log(`❌ ${token.symbol}: ERROR (${err})`);
    }

    // Rate limit buffer
    await new Promise((r) => setTimeout(r, 200));
  }
}

checkPools();