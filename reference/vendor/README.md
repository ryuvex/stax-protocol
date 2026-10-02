Unmodified upstream sources the Stax staking/rewards contracts are forked from.
Kept out of `contracts/` so Hardhat does not try to compile them.

- StakingRewards.synthetix.sol — Synthetix StakingRewards (via Ubeswap's verbatim vendored copy,
  https://github.com/Ubeswap/ubeswap-farming/blob/master/contracts/synthetix/contracts/StakingRewards.sol).
  Forked into contracts/StaxStaking.sol: custody only (stake / withdraw / exit / balances / events / recoverERC20);
  all reward accrual removed, Owned -> OpenZeppelin Ownable2Step.
- MerkleDistributor.uniswap.sol + IMerkleDistributor.uniswap.sol — Uniswap merkle-distributor
  (https://github.com/Uniswap/merkle-distributor). Forked into contracts/StaxRewardsDistributor.sol:
  same leaf / bitmap / proof check, made per-epoch with owner-published roots funded from the vault's rewards share.

Review the diff between these files and the contracts, not the contracts in isolation.
