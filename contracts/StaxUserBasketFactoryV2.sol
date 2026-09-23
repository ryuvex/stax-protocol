// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {StaxUserBasketV2, IStaxVaultV2Config} from "./StaxUserBasketV2.sol";

/// @notice Permissionless factory for StaxUserBasketV2 clones, bound to one StaxVaultV2.
/// Deploys its own implementation in the constructor (so only this factory can initialize clones),
/// then deploys + initializes each clone atomically. No owner, no admin functions.
/// The flat creation fee goes 100% to V2's current treasury as spam deterrence.
contract StaxUserBasketFactoryV2 {
    using SafeERC20 for IERC20;

    error ZeroVault();
    error ZeroUsdg();

    address public immutable mainVault;
    address public immutable implementation;
    address public immutable usdg;
    uint256 public constant CREATION_FEE_USDG = 2e6; // USDG has 6 decimals

    /// @notice True for every clone this factory created.
    mapping(address => bool) public isUserBasket;
    address[] public baskets;

    event BasketCreated(
        address indexed clone, address indexed token, address indexed creator,
        string name, string symbol, address[] tickers, uint256[] weights
    );

    constructor(address _mainVault) {
        require(_mainVault != address(0), ZeroVault());
        mainVault = _mainVault;
        implementation = address(new StaxUserBasketV2(_mainVault));
        usdg = IStaxVaultV2Config(_mainVault).usdg();
        require(usdg != address(0), ZeroUsdg());
    }

    function treasury() public view returns (address) { return IStaxVaultV2Config(mainVault).treasury(); }
    function basketCount() external view returns (uint256) { return baskets.length; }

    /// @notice Fee is pulled first so a reverted initialize (e.g. unregistered ticker) charges nothing.
    function createUserBasket(
        string memory basketName,
        string memory basketSymbol,
        address[] memory tickers,
        uint256[] memory weights
    ) external returns (address clone) {
        IERC20(usdg).safeTransferFrom(msg.sender, treasury(), CREATION_FEE_USDG);
        clone = Clones.clone(implementation);
        StaxUserBasketV2(clone).initialize(basketName, basketSymbol, tickers, weights, msg.sender);
        isUserBasket[clone] = true;
        baskets.push(clone);
        emit BasketCreated(clone, StaxUserBasketV2(clone).token(), msg.sender, basketName, basketSymbol, tickers, weights);
    }
}
