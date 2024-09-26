// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.27;

import "@balancer-labs/v2-interfaces/contracts/vault/IVault.sol";
import "@balancer-labs/v2-interfaces/contracts/vault/IFlashLoanRecipient.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";

contract Arbitrage is IFlashLoanRecipient {
    IVault private constant vault =
        IVault(0xBA12222222228d8Ba445958a75a0704d566BF2C8); // Balancer Vault for flash loans

    IUniswapV2Router02 public immutable sRouter; // Sushiswap Router
    IUniswapV2Router02 public immutable pRouter; // Pancakeswap Router

    address public owner;
    address private constant WBTC = 0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599; // Wrapped Bitcoin (WBTC) address on Ethereum
    address private constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2; // Wrapped Ether (WETH) address on Ethereum

    constructor(
        address _sRouter, // Sushiswap Router
        address _pRouter // Pancakeswap Router
    ) {
        sRouter = IUniswapV2Router02(_sRouter);
        pRouter = IUniswapV2Router02(_pRouter);
        owner = msg.sender;
    }

    function executeTrade(uint256 _flashAmount) external {
        bytes memory data = abi.encode(WBTC, WETH);

        // Token to flash loan
        IERC20;
        tokens[0] = IERC20(WBTC);

        // Flash loan amount
        uint256;
        amounts[0] = _flashAmount;

        vault.flashLoan(this, tokens, amounts, data);
    }

    function receiveFlashLoan(
        IERC20[] memory tokens,
        uint256[] memory amounts,
        uint256[] memory feeAmounts,
        bytes memory userData
    ) external override {
        require(msg.sender == address(vault));

        uint256 flashAmount = amounts[0];

        // Decode userData to get token addresses
        (address token0, address token1) = abi.decode(
            userData,
            (address, address)
        );

        // Step 1: Swap WBTC for WETH on PancakeSwap
        address;
        path[0] = WBTC;
        path[1] = WETH;
        _swapOnPancakeSwap(path, flashAmount, 0);

        // Step 2: Swap WETH for WBTC on Sushiswap
        uint256 amountWETH = IERC20(WETH).balanceOf(address(this));
        path[0] = WETH;
        path[1] = WBTC;
        _swapOnSushiSwap(path, amountWETH, flashAmount);

        // Repay the flash loan
        IERC20(WBTC).transfer(address(vault), flashAmount);

        // Transfer remaining WBTC to the owner as profit
        IERC20(WBTC).transfer(owner, IERC20(WBTC).balanceOf(address(this)));
    }

    // Internal function for swapping on PancakeSwap
    function _swapOnPancakeSwap(
        address[] memory _path,
        uint256 _amountIn,
        uint256 _amountOut
    ) internal {
        // Approve the token transfer to the PancakeSwap router
        require(
            IERC20(_path[0]).approve(address(pRouter), _amountIn),
            "PancakeSwap approval failed."
        );

        // Perform the token swap on PancakeSwap
        pRouter.swapExactTokensForTokens(
            _amountIn, // Amount of input tokens to send
            _amountOut, // Minimum amount of output tokens to receive
            _path, // Swap path (array of token addresses)
            address(this), // Recipient address
            block.timestamp + 1200 // Deadline for the swap
        );
    }

    // Internal function for swapping on Sushiswap
    function _swapOnSushiSwap(
        address[] memory _path,
        uint256 _amountIn,
        uint256 _amountOut
    ) internal {
        // Approve the token transfer to the Sushiswap router
        require(
            IERC20(_path[0]).approve(address(sRouter), _amountIn),
            "Sushiswap approval failed."
        );

        // Perform the token swap on Sushiswap
        sRouter.swapExactTokensForTokens(
            _amountIn, // Amount of input tokens to send
            _amountOut, // Minimum amount of output tokens to receive
            _path, // Swap path (array of token addresses)
            address(this), // Recipient address
            block.timestamp + 1200 // Deadline for the swap
        );
    }
}
