// SPDX-License-Identifier: MIT
// solhint-disable not-rely-on-time
pragma solidity ^0.8.28;

// Forked from Synthetix StakingRewards (reference/vendor/StakingRewards.synthetix.sol).
// Kept: the custody scaffolding -- stake / withdraw / exit, nonReentrant, SafeERC20, per-account
//       balances, total supply, Staked / Withdrawn events, recoverERC20 (never the staking token).
// Removed: every reward mechanic (rewardsToken, rewardRate, periodFinish, rewardPerToken,
//       updateReward, notifyRewardAmount, rewardsDuration, getReward, RewardsDistributionRecipient).
//       Stax computes rewards off-chain from these events and pays through StaxRewardsDistributor.
// Changed: SafeMath/Math dropped (0.8 checked arithmetic), Owned -> OpenZeppelin Ownable2Step,
//       events carry block.timestamp and the new balance so the indexer needs no extra reads.
//
// Guarantees: withdraw is unconditional -- no lockup, no pause, no owner function can block or
// move a staker's STAX. The owner can only recover *other* tokens sent here by mistake.

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";

contract StaxStaking is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /* ========== STATE VARIABLES ========== */

    IERC20 public immutable stakingToken;

    uint256 private _totalSupply;
    mapping(address => uint256) private _balances;

    /* ========== CONSTRUCTOR ========== */

    constructor(address _owner, address _stakingToken) Ownable(_owner) {
        require(_stakingToken != address(0), "Zero staking token");
        stakingToken = IERC20(_stakingToken);
    }

    /* ========== VIEWS ========== */

    function totalSupply() external view returns (uint256) {
        return _totalSupply;
    }

    function balanceOf(address account) external view returns (uint256) {
        return _balances[account];
    }

    /* ========== MUTATIVE FUNCTIONS ========== */

    function stake(uint256 amount) external nonReentrant {
        require(amount > 0, "Cannot stake 0");
        _totalSupply += amount;
        _balances[msg.sender] += amount;
        stakingToken.safeTransferFrom(msg.sender, address(this), amount);
        emit Staked(msg.sender, amount, _balances[msg.sender], block.timestamp);
    }

    function withdraw(uint256 amount) public nonReentrant {
        require(amount > 0, "Cannot withdraw 0");
        _totalSupply -= amount;
        _balances[msg.sender] -= amount; // reverts on insufficient balance (checked arithmetic)
        stakingToken.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount, _balances[msg.sender], block.timestamp);
    }

    function exit() external {
        withdraw(_balances[msg.sender]);
    }

    /* ========== RESTRICTED FUNCTIONS ========== */

    // Added to support recovering tokens sent here by mistake. The staking token is excluded,
    // so the owner can never touch staked STAX.
    function recoverERC20(address tokenAddress, uint256 tokenAmount) external onlyOwner {
        require(tokenAddress != address(stakingToken), "Cannot withdraw the staking token");
        IERC20(tokenAddress).safeTransfer(owner(), tokenAmount);
        emit Recovered(tokenAddress, tokenAmount);
    }

    /* ========== EVENTS ========== */

    event Staked(address indexed user, uint256 amount, uint256 newBalance, uint256 timestamp);
    event Withdrawn(address indexed user, uint256 amount, uint256 newBalance, uint256 timestamp);
    event Recovered(address token, uint256 amount);
}
