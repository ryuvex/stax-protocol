import { expect } from "chai";
import { timeWeightedAverage, multiplierFor, computePayouts, ONE, DEFAULT_PARAMS } from "../scripts/rewards/scoring.mjs";
import { buildTree, verify } from "../scripts/rewards/merkle.mjs";

const DAY = 86400;
const usd = (n: number) => BigInt(Math.round(n * 1e6)) * 10n ** 12n; // USD, 18 decimals

describe("reward scoring (pure)", () => {
  it("time-weights balances and reports held fraction", () => {
    // held 100 for the whole week
    expect(timeWeightedAverage(usd(100), [], 0, 7 * DAY)).to.deep.equal({ average: usd(100), heldFraction: 1 });
    // deposited on day 6: counts 1/7, held fraction 1/7
    const r = timeWeightedAverage(0n, [{ t: 6 * DAY, value: usd(700) }], 0, 7 * DAY);
    expect(r.average).to.equal(usd(100));
    expect(r.heldFraction).to.be.closeTo(1 / 7, 1e-9);
    // in day 1, out day 3: 2/7 of the time
    const r2 = timeWeightedAverage(0n, [{ t: DAY, value: usd(70) }, { t: 3 * DAY, value: 0n }], 0, 7 * DAY);
    expect(r2.average).to.equal(usd(20));
    expect(r2.heldFraction).to.be.closeTo(2 / 7, 1e-9);
    // changes before the window set the initial value; changes after are ignored
    const r3 = timeWeightedAverage(0n, [{ t: -DAY, value: usd(50) }, { t: 10 * DAY, value: 0n }], 0, 7 * DAY);
    expect(r3.average).to.equal(usd(50));
  });

  it("multiplier is bounded, diminishing, and 1 with no stake", () => {
    expect(multiplierFor(0n)).to.equal(1);
    expect(multiplierFor(DEFAULT_PARAMS.stakeForMax)).to.equal(DEFAULT_PARAMS.multiplierCap);
    expect(multiplierFor(DEFAULT_PARAMS.stakeForMax * 100n)).to.equal(DEFAULT_PARAMS.multiplierCap); // whale: capped
    const quarter = multiplierFor(DEFAULT_PARAMS.stakeForMax / 4n); // sqrt(0.25)=0.5 -> 1.5
    expect(quarter).to.be.closeTo(1.5, 1e-12);
    expect(multiplierFor(DEFAULT_PARAMS.stakeForMax / 4n, { ...DEFAULT_PARAMS, curve: "linear" })).to.be.closeTo(1.25, 1e-12);
    expect(multiplierFor(DEFAULT_PARAMS.stakeForMax, { ...DEFAULT_PARAMS, multiplierCap: 3 })).to.equal(3);
  });

  it("splits the pool by TVL x multiplier, drops flash wallets, never over-distributes", () => {
    const total = 1_000_000n; // 1.000000 USDG
    const wallets = [
      { account: "0x1000000000000000000000000000000000000001", tvlTw: usd(1000), heldFraction: 1, stakeTw: 0n },                       // base
      { account: "0x1000000000000000000000000000000000000002", tvlTw: usd(1000), heldFraction: 1, stakeTw: DEFAULT_PARAMS.stakeForMax }, // same TVL, max stake -> 2x
      { account: "0x1000000000000000000000000000000000000003", tvlTw: usd(1000), heldFraction: 0.2, stakeTw: DEFAULT_PARAMS.stakeForMax }, // flash: ineligible
      { account: "0x1000000000000000000000000000000000000004", tvlTw: 0n, heldFraction: 0, stakeTw: DEFAULT_PARAMS.stakeForMax * 10n },    // stake only, no TVL: nothing
    ];
    const r = computePayouts(wallets, total);
    expect(r.payouts[2].eligible).to.equal(false);
    expect(r.payouts[3].eligible).to.equal(false);
    expect(r.payouts[0].amount).to.equal(333_333n);
    expect(r.payouts[1].amount).to.equal(666_666n);
    expect(r.distributed).to.equal(999_999n);
    expect(r.dust).to.equal(1n);
    expect(r.distributed + r.dust).to.equal(total);
    // nobody eligible -> nothing paid
    expect(computePayouts([wallets[3]], total).distributed).to.equal(0n);
  });

  it("merkle tree round-trips every leaf and rejects tampering", () => {
    const leaves = Array.from({ length: 7 }, (_, i) => ({ index: i, account: `0x${(i + 1).toString(16).padStart(40, "0")}`, amount: BigInt(i + 1) * 1000n }));
    const { root, proofs } = buildTree(leaves);
    for (const l of leaves) expect(verify(proofs[l.index], root, l.index, l.account, l.amount)).to.equal(true);
    expect(verify(proofs[2], root, 2, leaves[2].account, leaves[2].amount + 1n)).to.equal(false);
    expect(verify(proofs[2], root, 3, leaves[2].account, leaves[2].amount)).to.equal(false);
    expect(buildTree([leaves[0]]).root).to.not.equal(root);
  });
});
