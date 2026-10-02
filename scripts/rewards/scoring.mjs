// Pure reward scoring for Stax epochs. No I/O, no chain: given timelines, produce payouts.
// Everything is integer math on bigint except the multiplier curve, which is bounded in [1, cap].
//
// Definitions (per wallet, over an epoch [start, end)):
//   tvlTw      time-weighted average basket value in USD, 18 decimals
//   heldFrac   fraction of the epoch during which the wallet had any basket value (0..1)
//   stakeTw    time-weighted average STAX staked, 18 decimals
//   multiplier 1 + (cap - 1) * curve(min(1, stakeTw / stakeForMax))
//   weight     tvlTw * multiplier (eligible only if heldFrac >= minHeldFraction and tvlTw > 0)
//   payout     floor(total * weight / sumWeights), in the reward token's smallest unit
// Flash behaviour: a deposit held for 1 of 7 days contributes 1/7 of its value to tvlTw, and a
// wallet that was empty most of the epoch fails minHeldFraction. Staking is time-weighted the same
// way, so staking just before a snapshot earns almost nothing. No per-stake bookkeeping is needed.

export const ONE = 10n ** 18n;

export const DEFAULT_PARAMS = Object.freeze({
  multiplierCap: 2.0,           // max boost from staking (Dan: 2x or 3x)
  stakeForMax: 100_000n * ONE,  // STAX (18 dec) at which the boost reaches the cap
  curve: "sqrt",                // "sqrt" (diminishing returns) or "linear"
  minHeldFraction: 0.5,         // must hold basket value for at least this share of the epoch
});

/** Time-weighted average of a step function over [start, end).
 *  changes: sorted [{t, value}] where value applies from t onward; initial applies before the first change. */
export function timeWeightedAverage(initial, changes, start, end) {
  if (end <= start) throw new Error("empty window");
  let value = initial, t = start, acc = 0n, held = 0n;
  for (const c of changes) {
    if (c.t <= start) { value = c.value; continue; }
    if (c.t >= end) break;
    const dt = BigInt(c.t - t);
    acc += value * dt; if (value > 0n) held += dt;
    value = c.value; t = c.t;
  }
  const dt = BigInt(end - t);
  acc += value * dt; if (value > 0n) held += dt;
  const span = BigInt(end - start);
  return { average: acc / span, heldFraction: Number(held) / Number(span) };
}

export function multiplierFor(stakeTw, params = DEFAULT_PARAMS) {
  if (params.stakeForMax <= 0n) return 1;
  const x = Math.min(1, Number(stakeTw) / Number(params.stakeForMax));
  const f = params.curve === "linear" ? x : Math.sqrt(x);
  return 1 + (params.multiplierCap - 1) * f;
}

/** wallets: [{account, tvlTw (bigint 18d), heldFraction, stakeTw (bigint 18d)}]; total: bigint reward units. */
export function computePayouts(wallets, total, params = DEFAULT_PARAMS) {
  const SCALE = 1_000_000n; // multiplier carried as integer millionths to keep the split exact
  const rows = wallets.map((w) => {
    const eligible = w.tvlTw > 0n && w.heldFraction >= params.minHeldFraction;
    const m = eligible ? multiplierFor(w.stakeTw, params) : 0;
    const mScaled = BigInt(Math.round(m * Number(SCALE)));
    return { ...w, eligible, multiplier: m, weight: eligible ? w.tvlTw * mScaled : 0n };
  });
  const sum = rows.reduce((s, r) => s + r.weight, 0n);
  let distributed = 0n;
  const payouts = rows.map((r) => {
    const amount = sum === 0n ? 0n : (total * r.weight) / sum;
    distributed += amount;
    return { ...r, amount };
  });
  return { payouts, sumWeights: sum, distributed, dust: total - distributed };
}
