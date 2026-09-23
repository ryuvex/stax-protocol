// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {StaxUserBasketV2} from "./StaxUserBasketV2.sol";

/// @notice Permissionless factory for StaxUserBasketV2 clones. Deploys and initializes
/// atomically (no uninitialized-clone window). No owner, no admin functions.
/// The flat creation fee goes 100% to treasury as spam deterrence.
contract StaxUserBasketFactoryV2 {
    using SafeERC20 for IERC20;

    error ZeroImplementation();
    error ZeroUsdg();
    error ZeroTreasury();
    error ImplementationVaultMismatch();

    address public immutable implementation;
    address public immutable usdg;
    address public immutable treasury;
    uint256 public constant CREATION_FEE_USDG = 2e6; // USDG has 6 decimals

    event BasketCreated(address indexed clone, address indexed creator, string name, address[] tickers, uint256[] weights);

    constructor(address _implementation, address _treasury) {
        require(_implementation != address(0), ZeroImplementation());
        require(_treasury != address(0), ZeroTreasury());
        address _usdg = StaxUserBasketV2(_implementation).usdg();
        require(_usdg != address(0), ZeroUsdg());
        require(StaxUserBasketV2(_implementation).treasury() == _treasury, ImplementationVaultMismatch());
        implementation = _implementation;
        usdg = _usdg;
        treasury = _treasury;
    }

    /// @notice Fee is pulled first so a reverted initialize (e.g. unregistered ticker) charges nothing.
    function createUserBasket(
        string memory basketName,
        string memory basketSymbol,
        address[] memory tickers,
        uint256[] memory weights
    ) external returns (address clone) {
        IERC20(usdg).safeTransferFrom(msg.sender, treasury, CREATION_FEE_USDG);
        clone = Clones.clone(implementation);
        StaxUserBasketV2(clone).initialize(basketName, basketSymbol, tickers, weights, msg.sender);
        emit BasketCreated(clone, msg.sender, basketName, tickers, weights);
    }
}
