// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.28;

// Forked from Uniswap MerkleDistributor (reference/vendor/MerkleDistributor.uniswap.sol).
// Kept: the leaf encoding keccak256(abi.encodePacked(index, account, amount)), the packed claimed
//       bitmap, the MerkleProof check, the Claimed event, SafeERC20 transfer to `account`.
// Changed: one immutable root -> one root per *epoch*, published by the owner. Each epoch's total
//       must be covered by USDG the contract holds and has not already promised to earlier epochs,
//       so a wrong root can never pay out more than the pool has. Optional expiry per epoch lets
//       unclaimed USDG roll back into the pool for later epochs.
//
// Funding: the vault's `rewardsPool` is set to this contract, so StaxVaultV2.claimRewardsPool()
// sends the 30% fee share here. The contract does no scoring: who earned what is computed
// off-chain (TVL x bounded staking multiplier x duration) and summarised as the epoch's root.
// It pays USDG only. Converting the claim into STAX, a basket or gacha pulls is the user's own
// follow-on transaction in the frontend; nothing is ever routed automatically.

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";

error AlreadyClaimed();
error InvalidProof();
error EpochNotFound();
error EpochExpired();
error EpochNotExpired();
error ZeroRoot();
error ZeroAmount();
error InsufficientUnallocated(uint256 requested, uint256 available);
error RecoveryNotAllowed();

contract StaxRewardsDistributor is Ownable2Step {
    using SafeERC20 for IERC20;

    struct Epoch {
        bytes32 merkleRoot;
        uint256 total;      // USDG promised by this root
        uint256 claimed;    // USDG paid out so far
        uint64 publishedAt;
        uint64 expiresAt;   // 0 = never; after this, owner may recover the unclaimed remainder
        bool recovered;
    }

    address public immutable token;              // USDG
    uint256 public epochCount;
    mapping(uint256 => Epoch) public epochs;
    // epoch => packed array of booleans (same scheme as Uniswap)
    mapping(uint256 => mapping(uint256 => uint256)) private claimedBitMap;
    // USDG promised to published epochs and not yet claimed or recovered
    uint256 public outstanding;

    event EpochPublished(uint256 indexed epoch, bytes32 merkleRoot, uint256 total, uint64 expiresAt);
    event Claimed(uint256 indexed epoch, uint256 index, address account, uint256 amount);
    event Recovered(uint256 indexed epoch, uint256 amount);
    event TokenRecovered(address token, uint256 amount);

    constructor(address owner_, address token_) Ownable(owner_) {
        require(token_ != address(0), "Zero token");
        token = token_;
    }

    /* ========== VIEWS ========== */

    /// @notice USDG in the contract not yet promised to any epoch -- what the next root may distribute.
    function unallocated() public view returns (uint256) {
        uint256 bal = IERC20(token).balanceOf(address(this));
        return bal > outstanding ? bal - outstanding : 0;
    }

    function isClaimed(uint256 epoch, uint256 index) public view returns (bool) {
        uint256 claimedWordIndex = index / 256;
        uint256 claimedBitIndex = index % 256;
        uint256 claimedWord = claimedBitMap[epoch][claimedWordIndex];
        uint256 mask = (1 << claimedBitIndex);
        return claimedWord & mask == mask;
    }

    function _setClaimed(uint256 epoch, uint256 index) private {
        uint256 claimedWordIndex = index / 256;
        uint256 claimedBitIndex = index % 256;
        claimedBitMap[epoch][claimedWordIndex] = claimedBitMap[epoch][claimedWordIndex] | (1 << claimedBitIndex);
    }

    /* ========== CLAIM (permissionless, pays `account`) ========== */

    function claim(uint256 epoch, uint256 index, address account, uint256 amount, bytes32[] calldata merkleProof) public {
        Epoch storage e = epochs[epoch];
        if (e.merkleRoot == bytes32(0)) revert EpochNotFound();
        if (e.expiresAt != 0 && block.timestamp > e.expiresAt) revert EpochExpired();
        if (isClaimed(epoch, index)) revert AlreadyClaimed();

        // Verify the merkle proof (leaf identical to Uniswap's distributor).
        bytes32 node = keccak256(abi.encodePacked(index, account, amount));
        if (!MerkleProof.verify(merkleProof, e.merkleRoot, node)) revert InvalidProof();

        // Mark it claimed and send the token.
        _setClaimed(epoch, index);
        e.claimed += amount;
        outstanding -= amount;
        IERC20(token).safeTransfer(account, amount);

        emit Claimed(epoch, index, account, amount);
    }

    /// @notice Claim several epochs for the same account in one transaction.
    function claimMany(uint256[] calldata epoch, uint256[] calldata index, address account, uint256[] calldata amount, bytes32[][] calldata merkleProof) external {
        uint256 n = epoch.length;
        require(index.length == n && amount.length == n && merkleProof.length == n, "Length mismatch");
        for (uint256 i = 0; i < n; i++) claim(epoch[i], index[i], account, amount[i], merkleProof[i]);
    }

    /* ========== RESTRICTED FUNCTIONS ========== */

    /// @notice Publish an epoch's root. `total` must be covered by unallocated USDG already held here.
    function publishEpoch(bytes32 merkleRoot, uint256 total, uint64 expiresAt) external onlyOwner returns (uint256 epoch) {
        if (merkleRoot == bytes32(0)) revert ZeroRoot();
        if (total == 0) revert ZeroAmount();
        uint256 avail = unallocated();
        if (total > avail) revert InsufficientUnallocated(total, avail);
        epoch = ++epochCount;
        epochs[epoch] = Epoch({merkleRoot: merkleRoot, total: total, claimed: 0, publishedAt: uint64(block.timestamp), expiresAt: expiresAt, recovered: false});
        outstanding += total;
        emit EpochPublished(epoch, merkleRoot, total, expiresAt);
    }

    /// @notice After an epoch expires, return its unclaimed USDG to the unallocated pool.
    function recoverExpired(uint256 epoch) external onlyOwner {
        Epoch storage e = epochs[epoch];
        if (e.merkleRoot == bytes32(0)) revert EpochNotFound();
        if (e.expiresAt == 0 || block.timestamp <= e.expiresAt) revert EpochNotExpired();
        if (e.recovered) revert RecoveryNotAllowed();
        e.recovered = true;
        uint256 remainder = e.total - e.claimed;
        outstanding -= remainder;
        emit Recovered(epoch, remainder);
    }

    /// @notice Recover tokens other than USDG sent here by mistake. USDG itself never leaves except via claims.
    function recoverERC20(address tokenAddress, uint256 tokenAmount) external onlyOwner {
        if (tokenAddress == token) revert RecoveryNotAllowed();
        IERC20(tokenAddress).safeTransfer(owner(), tokenAmount);
        emit TokenRecovered(tokenAddress, tokenAmount);
    }
}
