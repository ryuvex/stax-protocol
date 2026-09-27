// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {StaxVaultV2} from "../../contracts/StaxVaultV2.sol";
import {StaxBasketTokenDeployer} from "../../contracts/StaxBasketTokenDeployer.sol";
import {StaxV3RouteValidator} from "../../contracts/StaxV3RouteValidator.sol";
import {UnifiedTwapRegistry} from "../../contracts/Twap.sol";
import {MockERC20Decimals} from "../../contracts/mocks/MockERC20Decimals.sol";
import {MockUniversalRouter} from "../../contracts/mocks/MockUniversalRouter.sol";
import {MockPermit2} from "../../contracts/mocks/MockPermit2.sol";
import {MockPriceOracle} from "../../contracts/mocks/MockPriceOracle.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

/// Controlled constant-price observations, NOT real AMM economics/history.
/// Exercises the actual registry/validator rather than replacing their quote APIs.
contract InvariantObservationPool {
    address public factory;
    address public token0;
    address public token1;
    uint24 public constant fee = 3000;
    uint128 public constant liquidity = 1e24;
    int24 public tick;
    function initialize(address a,address b,int24 t) external {
        require(factory==address(0)); factory=msg.sender; token0=a; token1=b; tick=t;
    }
    function slot0() external view returns(uint160,int24,uint16,uint16,uint16,uint8,bool) {
        return (TickMath.getSqrtPriceAtTick(tick),tick,0,2,2,0,true);
    }
    function observations(uint256) external view returns(uint32,int56,uint160,bool) {
        return (uint32(block.timestamp),int56(tick)*int56(uint56(block.timestamp)),uint160((block.timestamp<<128)/liquidity),true);
    }
    function observe(uint32[] calldata ago) external view returns(int56[] memory ticks,uint160[] memory spl) {
        ticks=new int56[](ago.length); spl=new uint160[](ago.length);
        for(uint256 i;i<ago.length;i++){
            require(ago[i]<=block.timestamp);
            uint256 t=block.timestamp-ago[i];
            ticks[i]=int56(tick)*int56(uint56(t)); spl[i]=uint160((t<<128)/liquidity);
        }
    }
}
contract InvariantPoolFactory {
    mapping(bytes32=>address) internal pools;
    function getPool(address a,address b,uint24 fee) external view returns(address){
        if(a>b)(a,b)=(b,a); return pools[keccak256(abi.encode(a,b,fee))];
    }
    function create(address token,address usdg) external returns(address){
        (address a,address b)=token<usdg?(token,usdg):(usdg,token);
        bytes32 salt=keccak256(abi.encode(a,b,uint24(3000)));
        InvariantObservationPool p=new InvariantObservationPool{salt:salt}();
        // 18-decimal ticker / 6-decimal USDG, roughly one USDG per token.
        p.initialize(a,b,token==a?int24(-276324):int24(276324));
        pools[salt]=address(p);return address(p);
    }
}

contract V2SolvencyHandler is Test {
    StaxVaultV2 public vault;
    MockERC20Decimals public usdg;
    address[3] public assets;
    address[3] public actors;
    address[2] public shares;
    uint256 public calls;
    uint256 public mints;
    uint256 public redeems;
    uint256 public exits;
    uint256 public donations;
    uint256 public transfers;
    uint256 public feeClaims;
    uint256 public rejectedBounds;
    constructor(StaxVaultV2 v,MockERC20Decimals u,address[3] memory a){
        vault=v;usdg=u;assets=a;
        for(uint256 i;i<3;i++)actors[i]=address(uint160(0xA110+i));
        (,shares[0],,,,)=v.baskets(1); (,shares[1],,,,)=v.baskets(2);
    }
    function seed() external {
        require(calls==0&&mints==0);
        for(uint256 i;i<3;i++)for(uint256 b=1;b<=2;b++)_mint(i,b,1000e6);
    }
    function _mint(uint256 who,uint256 id,uint256 amount) internal {
        usdg.mint(actors[who],amount);
        vm.startPrank(actors[who]);usdg.approve(address(vault),amount);
        vault.mint(id,amount,1,block.timestamp);vm.stopPrank();mints++;
    }
    function _redeem(uint256 who,uint256 id,uint256 divisor) internal {
        uint256 balance=IERC20(shares[id-1]).balanceOf(actors[who]);
        // Avoid dust-only no-op runs: create a genuine position before withdrawing.
        if(balance<1e18){_mint(who,id,100e6);balance=IERC20(shares[id-1]).balanceOf(actors[who]);}
        vm.prank(actors[who]);vault.redeem(id,balance/divisor,1,block.timestamp);redeems++;
    }
    function step(uint256 operation,uint256 actorSeed,uint256 basketSeed,uint256 amountSeed) external {
        uint256 who=actorSeed%3;uint256 id=basketSeed%2+1;uint256 other=id==1?2:1;
        uint256[3] memory untouched;
        for(uint256 i;i<3;i++)untouched[i]=vault.basketTickerHoldings(other,assets[i]);
        uint256 kind=operation%7;calls++;
        if(kind==0)_mint(who,id,20e6+amountSeed%9980e6);
        else if(kind==1)_redeem(who,id,2+amountSeed%3);
        else if(kind==2){
            // Remove every circulating holder, then mint into the dead-share-only
            // residual state: specifically exercise post-exit re-genesis.
            for(uint256 i;i<3;i++){
                uint256 bal=IERC20(shares[id-1]).balanceOf(actors[i]);
                if(bal<1e18){_mint(i,id,100e6);bal=IERC20(shares[id-1]).balanceOf(actors[i]);}
                vm.prank(actors[i]);vault.redeem(id,bal,1,block.timestamp);redeems++;
            }
            _mint(who,id,20e6+amountSeed%980e6);exits++;
        }
        else if(kind==3){
            MockERC20Decimals(assets[amountSeed%3]).mint(address(vault),1+amountSeed%1e18);
            usdg.mint(address(vault),1+amountSeed%1e6);donations++;
        }else if(kind==4){
            uint256 balance=IERC20(shares[id-1]).balanceOf(actors[who]);
            vm.prank(actors[who]);IERC20(shares[id-1]).transfer(actors[(who+1)%3],balance/2);transfers++;
        }else if(kind==5){
            if(vault.pendingRewardsPool()>0)vault.claimRewardsPool();
            if(vault.pendingTreasuryFees()>0)vault.claimTreasuryFees();feeClaims++;
        }else{
            uint256 beforeSupply=IERC20(shares[id-1]).totalSupply();
            uint256 beforeFees=vault.pendingBuyBurn()+vault.pendingRewardsPool()+vault.pendingTreasuryFees();
            uint256 beforeUsd=usdg.balanceOf(address(vault));
            usdg.mint(actors[who],100e6);vm.startPrank(actors[who]);usdg.approve(address(vault),100e6);
            vm.expectRevert(StaxVaultV2.UserLimitNotMet.selector);
            vault.mint(id,100e6,type(uint256).max,block.timestamp);vm.stopPrank();
            assertEq(IERC20(shares[id-1]).totalSupply(),beforeSupply);
            assertEq(usdg.balanceOf(address(vault)),beforeUsd);
            assertEq(vault.pendingBuyBurn()+vault.pendingRewardsPool()+vault.pendingTreasuryFees(),beforeFees);
            rejectedBounds++;
        }
        for(uint256 i;i<3;i++)assertEq(vault.basketTickerHoldings(other,assets[i]),untouched[i],"unrelated basket ledger changed");
    }
    function assertSolvent() public view {
        for(uint256 i;i<3;i++){
            uint256 claimed=vault.basketTickerHoldings(1,assets[i])+vault.basketTickerHoldings(2,assets[i]);
            assertLe(claimed,IERC20(assets[i]).balanceOf(address(vault)),"asset ledger insolvent");
        }
        assertGe(usdg.balanceOf(address(vault)),vault.pendingBuyBurn()+vault.pendingRewardsPool()+vault.pendingTreasuryFees(),"fee obligations insolvent");
        for(uint256 b;b<2;b++){
            uint256 held=IERC20(shares[b]).balanceOf(vault.DEAD_ADDRESS());
            for(uint256 i;i<3;i++)held+=IERC20(shares[b]).balanceOf(actors[i]);
            assertEq(held,IERC20(shares[b]).totalSupply(),"unaccounted shares");
        }
    }
}

contract StaxVaultV2InvariantTest is StdInvariant,Test {
    StaxVaultV2 public vault;
    V2SolvencyHandler public handler;
    function setUp() public {
        vm.warp(100000);
        MockERC20Decimals usdg=new MockERC20Decimals("USDG","USDG",6);
        MockPermit2 permit=new MockPermit2();
        MockUniversalRouter router=new MockUniversalRouter(address(permit),address(usdg));
        InvariantPoolFactory factory=new InvariantPoolFactory();
        StaxV3RouteValidator validator=new StaxV3RouteValidator(address(router),address(factory),keccak256(type(InvariantObservationPool).creationCode));
        UnifiedTwapRegistry registry=new UnifiedTwapRegistry(address(this),address(usdg),address(factory));
        MockPriceOracle feed=new MockPriceOracle(1e8,8);
        vault=new StaxVaultV2(address(this),address(new StaxBasketTokenDeployer()),new StaxVaultV2.LegacyTicker[](0),address(0xF001),address(0xF002),address(router),address(permit),address(usdg),address(feed),97200,address(0),address(validator));
        address[3] memory assets;
        usdg.mint(address(router),1e30);
        for(uint256 i;i<3;i++){
            MockERC20Decimals t=new MockERC20Decimals("Asset","AST",18);assets[i]=address(t);t.mint(address(router),1e36);
            uint256 price=1e18;
            if(i==0){
                // Shared asset has TWAP pricing; no stock oraclePaused dependency.
                t.setOraclePaused(true);
                address pool=factory.create(address(t),address(usdg));
                registry.configureToken(address(t),UnifiedTwapRegistry.SafetyParams(pool,3600,3600,1e20,1e20,100));
                vault.setTickerPoolV3(address(t),3000);
                vault.setTwapOracle(address(t),address(registry),200);
                (price,)=registry.quoteUsdg18(address(t));
            }else{
                vault.setPriceFeed(address(t),address(feed),97200);
                (address a,address b)=address(t)<address(usdg)?(address(t),address(usdg)):(address(usdg),address(t));
                vault.setTickerPool(address(t),a,b,3000,60,address(0));
            }
            router.setRate(address(usdg),address(t),1e48/price);
            router.setRate(address(t),address(usdg),price/1e12);
        }
        for(uint256 id=1;id<=2;id++){
            address[] memory ts=new address[](2);ts[0]=assets[0];ts[1]=assets[id];
            uint256[] memory weights=new uint256[](2);weights[0]=5000;weights[1]=5000;
            vault.createBasket(id,"Invariant basket","INV",ts,weights,1e30,1e30);
        }
        handler=new V2SolvencyHandler(vault,usdg,assets);handler.seed();
        bytes4[] memory selectors=new bytes4[](1);selectors[0]=handler.step.selector;
        targetContract(address(handler));targetSelector(FuzzSelector(address(handler),selectors));
    }
    function invariant_accounting() public view {handler.assertSolvent();}
    function test_invariantDetectsInsolventBalance() public {
        address asset=handler.assets(0);
        vm.mockCall(asset,abi.encodeCall(IERC20.balanceOf,(address(vault))),abi.encode(uint256(0)));
        vm.expectRevert();handler.assertSolvent();vm.clearMockedCalls();
    }
    function afterInvariant() public view {
        handler.assertSolvent();
        // Seed mints alone cannot satisfy these. Unexpected operation reverts fail
        // the campaign; successful outer no-ops cannot conceal broken mint/redeem.
        if(handler.calls()>=100){
            assertGt(handler.mints(),6);assertGt(handler.redeems(),0);
            assertGt(handler.exits(),0);assertGt(handler.rejectedBounds(),0);
        }
    }
}
