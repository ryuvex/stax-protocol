# StaxVault — Trust Assumptions & Known Non-Code Risks

This document captures what three independent adversarial security reviews
converged on: no working exploit was found executable by an unprivileged
attacker against the contract in its launch configuration (hookless V4
pools). That result is real, but it's conditional on specific trust
assumptions and operational disciplines that are not visible from "the
tests pass" — this document names them explicitly, for anyone evaluating
the protocol's real security posture (a depositor, a future auditor, a
funder, or the team itself six months from now).

None of the items below are code bugs. They are the trust boundaries this
design deliberately concentrates in specific, auditable places, rather
than spreading risk across the whole attack surface.

## 1. Pool routing is a trusted-owner power, not trustless

`setTickerPool`, `updateTickerPool`, and `setStaxSwapPool` are all
`onlyOwner`. The owner chooses which real V4 pool each ticker swaps
through — this is not adversarially validated on-chain beyond the
oracle-anchored 2% slippage floor.

**What this means concretely:** the owner can influence the *execution
price* users get on mint/redeem by choosing (or later repointing to) a
thin or unfavorable pool. The 2% floor bounds how bad this can get per
transaction, but within that band, pool selection is a real lever the
owner holds. This is inherent to routing through any real DEX — it is
not unique to this contract, and it does not let the owner directly move
user funds or break accounting. But "the owner can never block or steal
funds" should not be read as "the owner has zero influence over
execution" — pool selection is the one channel where owner discretion
does affect what users actually receive.

**Why `updateTickerPool` doesn't widen this boundary:** it was added
specifically to give the owner a way to fix a degraded or hostile pool
without permanently bricking redemption (see the `receive()` fix and the
set-once liveness issue both closed this cycle). It doesn't introduce new
owner power — the owner already held equivalent power via the initial
`setTickerPool` call. It closes a real liveness gap without changing the
trust model.

## 2. The hook allowlist is load-bearing, not decorative

`allowedHooks` defaults to rejecting every non-`address(0)` hook unless
the owner explicitly vets and approves it via `setHookAllowed`. Every
adversarial review this cycle confirmed the same structural fact from
different angles: **the entire delta-measurement safety of this
contract's swap accounting depends on hooks either not existing, or
being genuinely well-behaved.**

Two independent attack surfaces both terminate at "requires an
allowlisted hostile hook":
- A hook that inflates the measured token-balance delta during mint,
  causing over-crediting relative to real backing.
- A hook (or any code with a callback surface) that could theoretically
  time a forced-ETH injection during the native-ETH redeem path's
  balance measurement.

**In the current launch configuration — every real pool intended for use
is hookless (`hooks == address(0)`) — neither of these has any callback
surface to exploit.** That is confirmed clean. The moment any hook is
allowlisted in the future, vetting that hook's actual behavior is a
security-critical action **equivalent in weight to a code change**, not
an administrative formality. It should go through the same review rigor
as a contract upgrade, not be treated as a config tweak.

## 3. MEV / sandwich exposure within the 2% band is real and inherent

Every mint and redeem swaps at market against a public V4 pool with a
fixed 2% oracle-anchored slippage tolerance. A searcher can sandwich any
sizeable mint/redeem and extract value up to nearly the full 2% budget
per transaction. This is not theft from the contract or a flaw in its
logic — it's value users lose to ordinary MEV, the same as on any public
AMM. The oracle-vs-pool deviation check (the 2% floor) catches
manipulation beyond that band; it does not and cannot catch ordinary
sandwiching within it.

This isn't fixable in-contract without a fundamentally different
architecture (private mempool routing, or per-transaction user-supplied
minimums instead of a protocol-wide constant). Worth surfacing as a plain
UX/cost disclosure, and worth revisiting whether 2% is the right default
width once real, post-launch pool depth is confirmed empirically.

## 4. The manipulation defense is one layer, not two

Worth stating precisely so it isn't misremembered later: there is no
separate "spot price vs. oracle price" comparison anywhere in this
contract. The entire defense against DEX-price manipulation, on both
mint and redeem, **is** the `amountOutMinimum` floor — oracle price minus
2% — enforced by the router at swap time. That single check is
sufficient (anything worse than 2% off oracle reverts), but it is one
mechanism, not two independent layers. Any future documentation or
review should describe it that way.

## 5. Dust accumulation (by design, economically negligible)

Integer-division flooring in `_from18` means each mint can leave sub-unit
dust in the vault's pooled balances that never gets credited to any
basket's ledger. This is intentional and harmless — the core invariant
(`Σ basketTickerHoldings ≤ real token balance`) explicitly permits this,
and it does not affect any individual user's accounting. It does mean
there is currently no sweep function to recover this dust; if it's ever
worth reclaiming, that would be a small, separate, non-urgent addition.

## Summary for a reviewer or depositor

If you are evaluating this protocol's security, the honest one-line
version is: **the code has been checked hard and held up — three
independent adversarial passes found zero exploits against an
unprivileged attacker in the launch configuration.** What remains is not
a code weakness but a small number of explicit, intentional trust
concentrations: the owner controls pool routing, the hook allowlist is
the single point standing between "safe" and "exploitable" if it's ever
used carelessly, and ordinary MEV exposure exists on public pools the
same as everywhere else in DeFi. All three are named here, not hidden,
and all three are the kind of thing a team can operate safely around
with discipline — they are not latent bugs waiting to be found.
