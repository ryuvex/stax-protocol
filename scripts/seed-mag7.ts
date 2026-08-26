import { BASKETS } from "@/lib/baskets";

// v18.4 fix: this was hardcoded to "ai-infra", which no longer exists
// -- that basket is held for post-launch (see lib/baskets.ts). Pointing
// this at the real, live basket instead. Picking 3 representative
// tickers from Mag 7's real 7 for this visual's fixed 3-node layout --
// AAPL, MSFT, NVDA are all genuinely in the live basket, just not an
// exhaustive list of all 7 (the visual's geometry is built around
// exactly 3 ticker nodes; showing all 7 would need a real redesign,
// not a same-day fix).
const heroBasket = BASKETS.find((b) => b.id === "mag7")!;
const [aapl, msft, nvda] = heroBasket.tickers;

const DOT_COLOR = "#E07A2C";

// Column x-centers with generous gaps
const X_ETH = 50;
const X_VAULT = 170;
const X_TICK = 300;
const X_SAI = 420;

const Y_MID = 110;
const Y_TOP = 40;
const Y_BOT = 180;

// Vault rect
const VAULT_W = 76;
const VAULT_H = 52;
const VAULT_LEFT = X_VAULT - VAULT_W / 2;
const VAULT_RIGHT = X_VAULT + VAULT_W / 2;

// Node radii
const R_END = 26; // ETH & output token
const R_TICK = 22;

export function HeroVisual() {
  return (
    <div className="w-full">
      <div className="relative w-full overflow-hidden p-4 md:p-6">
        <svg
          viewBox="0 0 470 220"
          className="h-auto w-full"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            {/* ETH -> VAULT (straight) */}
            <path
              id="p-eth-vault"
              d={`M ${X_ETH + R_END} ${Y_MID} L ${VAULT_LEFT} ${Y_MID}`}
            />
            {/* VAULT -> tickers (curved) */}
            <path
              id="p-vault-t1"
              d={`M ${VAULT_RIGHT} ${Y_MID} C ${VAULT_RIGHT + 40} ${Y_MID}, ${X_TICK - R_TICK - 40} ${Y_TOP}, ${X_TICK - R_TICK} ${Y_TOP}`}
            />
            <path
              id="p-vault-t2"
              d={`M ${VAULT_RIGHT} ${Y_MID} L ${X_TICK - R_TICK} ${Y_MID}`}
            />
            <path
              id="p-vault-t3"
              d={`M ${VAULT_RIGHT} ${Y_MID} C ${VAULT_RIGHT + 40} ${Y_MID}, ${X_TICK - R_TICK - 40} ${Y_BOT}, ${X_TICK - R_TICK} ${Y_BOT}`}
            />
            {/* tickers -> output token (curved) */}
            <path
              id="p-t1-out"
              d={`M ${X_TICK + R_TICK} ${Y_TOP} C ${X_TICK + R_TICK + 40} ${Y_TOP}, ${X_SAI - R_END - 40} ${Y_MID}, ${X_SAI - R_END} ${Y_MID}`}
            />
            <path
              id="p-t2-out"
              d={`M ${X_TICK + R_TICK} ${Y_MID} L ${X_SAI - R_END} ${Y_MID}`}
            />
            <path
              id="p-t3-out"
              d={`M ${X_TICK + R_TICK} ${Y_BOT} C ${X_TICK + R_TICK + 40} ${Y_BOT}, ${X_SAI - R_END - 40} ${Y_MID}, ${X_SAI - R_END} ${Y_MID}`}
            />
          </defs>

          {/* Paths */}
          <g stroke="currentColor" strokeWidth="1" fill="none" className="text-border">
            <use href="#p-eth-vault" />
            <use href="#p-vault-t1" />
            <use href="#p-vault-t2" />
            <use href="#p-vault-t3" />
            <use href="#p-t1-out" />
            <use href="#p-t2-out" />
            <use href="#p-t3-out" />
          </g>

          {/* Traveling dots */}
          <g fill={DOT_COLOR}>
            {[
              { p: "p-eth-vault", begin: "0s" },
              { p: "p-vault-t1", begin: "0.9s" },
              { p: "p-vault-t2", begin: "1.1s" },
              { p: "p-vault-t3", begin: "1.3s" },
              { p: "p-t1-out", begin: "1.9s" },
              { p: "p-t2-out", begin: "2.1s" },
              { p: "p-t3-out", begin: "2.3s" },
            ].map(({ p, begin }) => (
              <circle key={p} r="2.5">
                <animateMotion dur="2.6s" repeatCount="indefinite" begin={begin}>
                  <mpath href={`#${p}`} />
                </animateMotion>
              </circle>
            ))}
          </g>

          {/* ETH (white with border) */}
          <g>
            <circle
              cx={X_ETH}
              cy={Y_MID}
              r={R_END}
              fill="white"
              stroke="black"
              strokeWidth="1"
            />
            <text
              x={X_ETH}
              y={Y_MID}
              textAnchor="middle"
              dy="0.35em"
              className="fill-black text-[11px] font-semibold"
            >
              ETH
            </text>
          </g>

          {/* VAULT (black) */}
          <g>
            <rect
              x={VAULT_LEFT}
              y={Y_MID - VAULT_H / 2}
              width={VAULT_W}
              height={VAULT_H}
              rx="10"
              fill="black"
            />
            <text
              x={X_VAULT}
              y={Y_MID}
              textAnchor="middle"
              dy="0.35em"
              className="fill-white text-[10px] font-semibold tracking-widest"
            >
              VAULT
            </text>
          </g>

          {/* Tickers -- 3 representative names from the live basket */}
          {[
            { y: Y_TOP, label: aapl.symbol, color: aapl.color },
            { y: Y_MID, label: msft.symbol, color: msft.color },
            { y: Y_BOT, label: nvda.symbol, color: nvda.color },
          ].map((t) => (
            <g key={t.label}>
              <circle
                cx={X_TICK}
                cy={t.y}
                r={R_TICK}
                fill="white"
                stroke="black"
                strokeWidth="1"
              />
              <text
                x={X_TICK}
                y={t.y}
                textAnchor="middle"
                dy="0.35em"
                className="fill-black text-[9px] font-semibold"
              >
                {t.label}
              </text>
            </g>
          ))}

          {/* Output token (black) */}
          <g>
            <circle cx={X_SAI} cy={Y_MID} r={R_END} fill="black" />
            <text
              x={X_SAI}
              y={Y_MID}
              textAnchor="middle"
              dy="0.35em"
              className="fill-white text-[11px] font-semibold"
            >
              {heroBasket.symbol}
            </text>
          </g>
        </svg>
      </div>
      <p className="mt-4 text-center text-sm text-muted-foreground">
        Your ETH buys the basket's stock tokens — you get one token back
        representing your share.
      </p>
    </div>
  );
}
