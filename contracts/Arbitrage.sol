// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.19;

import "@balancer-labs/v2-interfaces/contracts/vault/IVault.sol";
import "@balancer-labs/v2-interfaces/contracts/vault/IFlashLoanRecipient.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract Arbitrage is IFlashLoanRecipient, Ownable {
    IVault private constant VAULT =
        IVault(0xBA12222222228d8Ba445958a75a0704d566BF2C8);

    IUniswapV2Router02 public immutable sRouter;
    IUniswapV2Router02 public immutable uRouter;

    constructor(address _sRouter, address _uRouter) {
        sRouter = IUniswapV2Router02(_sRouter);
        uRouter = IUniswapV2Router02(_uRouter);
    }

    // Definir eventos para la transparencia
    event FlashLoanRequested(address indexed token, uint256 amount);
    event TokensSwapped(
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut
    );
    event ProfitTransferred(address indexed owner, uint256 profit);
    event FlashLoanRepaid(
        address indexed token,
        uint256 amountRepaid,
        uint256 fee
    );

    function executeTrade(
        address token0,
        address token1,
        address flashLoanToken,
        uint256 minProfit,
        uint256 slippageTolerance
    ) external onlyOwner {
        uint256 dynamicFlashLoanAmount = calculateDynamicLoanAmount(
            token0,
            token1
        );

        bytes memory data = abi.encode(
            token0,
            token1,
            flashLoanToken,
            minProfit,
            slippageTolerance
        );

        // Inicializamos el array tokens y amounts
        IERC20[] memory tokens = new IERC20[](1);
        tokens[0] = IERC20(flashLoanToken);

        uint256[] memory amounts = new uint256[](1);
        amounts[0] = dynamicFlashLoanAmount;

        // Emitir evento de solicitud de préstamo flash
        emit FlashLoanRequested(flashLoanToken, dynamicFlashLoanAmount);

        VAULT.flashLoan(this, tokens, amounts, data);
    }

    function receiveFlashLoan(
        IERC20[] memory tokens,
        uint256[] memory amounts,
        uint256[] memory feeAmounts,
        bytes memory userData
    ) external override {
        require(
            msg.sender == address(VAULT),
            "Only the vault can call this function"
        );

        uint256 flashAmount = amounts[0];

        (
            address token0,
            address token1,
            address flashLoanToken,
            uint256 minProfit,
            uint256 slippageTolerance
        ) = abi.decode(userData, (address, address, address, uint256, uint256));

        require(
            address(tokens[0]) == flashLoanToken,
            "Unexpected flash loan token"
        );

        uint256 gasStart = gasleft();

        if (flashLoanToken == token0) {
            uint256 token1Amount = _swapOnUniswap(
                token0,
                token1,
                flashAmount,
                slippageTolerance
            );

            uint256 gasUsed = gasStart - gasleft();
            uint256 gasCost = gasUsed * tx.gasprice;

            require(
                token1Amount >
                    flashAmount + feeAmounts[0] + minProfit + gasCost,
                "Trade is not profitable after gas fees"
            );

            uint256 token0Amount = _swapOnSushiswap(
                token1,
                token0,
                token1Amount,
                slippageTolerance
            );

            // Emitir evento de intercambio de tokens
            emit TokensSwapped(token1, token0, token1Amount, token0Amount);

            _repayAndProfit(token0, token0Amount, feeAmounts[0]);
        } else if (flashLoanToken == token1) {
            uint256 token0Amount = _swapOnUniswap(
                token1,
                token0,
                flashAmount,
                slippageTolerance
            );

            uint256 token1Amount = _swapOnSushiswap(
                token0,
                token1,
                token0Amount,
                slippageTolerance
            );

            uint256 gasUsed = gasStart - gasleft();
            uint256 gasCost = gasUsed * tx.gasprice;

            require(
                token1Amount >
                    flashAmount + feeAmounts[0] + minProfit + gasCost,
                "Trade is not profitable after gas fees"
            );

            // Emitir evento de intercambio de tokens
            emit TokensSwapped(token0, token1, token0Amount, token1Amount);

            _repayAndProfit(token1, token1Amount, feeAmounts[0]);
        } else {
            revert("Unsupported flash loan token");
        }
    }

    function _swapOnUniswap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 slippageTolerance
    ) internal returns (uint256) {
        address[] memory path = new address[](2);
        path[0] = tokenIn;
        path[1] = tokenOut;

        uint256[] memory amountsOut = uRouter.getAmountsOut(amountIn, path);
        uint256 amountOutMin = amountsOut[1] -
            ((amountsOut[1] * slippageTolerance) / 100);

        uint256 allowance = IERC20(tokenIn).allowance(
            address(this),
            address(uRouter)
        );

        if (allowance < amountIn) {
            IERC20(tokenIn).approve(address(uRouter), amountIn);
        }

        uint256[] memory amounts = uRouter.swapExactTokensForTokens(
            amountIn,
            amountOutMin,
            path,
            address(this),
            block.timestamp + 1200
        );

        return amounts[1];
    }

    function _swapOnSushiswap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 slippageTolerance
    ) internal returns (uint256) {
        address[] memory path = new address[](2);
        path[0] = tokenIn;
        path[1] = tokenOut;

        uint256[] memory amountsOut = sRouter.getAmountsOut(amountIn, path);
        uint256 amountOutMin = amountsOut[1] -
            ((amountsOut[1] * slippageTolerance) / 100);

        uint256 allowance = IERC20(tokenIn).allowance(
            address(this),
            address(sRouter)
        );

        if (allowance < amountIn) {
            IERC20(tokenIn).approve(address(sRouter), amountIn);
        }

        uint256[] memory amounts = sRouter.swapExactTokensForTokens(
            amountIn,
            amountOutMin,
            path,
            address(this),
            block.timestamp + 1200
        );

        return amounts[1];
    }

    function _repayAndProfit(
        address repayToken,
        uint256 repayAmount,
        uint256 feeAmount
    ) internal {
        uint256 repaymentAmount = repayAmount + feeAmount;
        IERC20(repayToken).transfer(address(VAULT), repaymentAmount);

        // Emitir evento de reembolso del préstamo flash
        emit FlashLoanRepaid(repayToken, repaymentAmount, feeAmount);

        uint256 profit = IERC20(repayToken).balanceOf(address(this));
        IERC20(repayToken).transfer(owner(), profit);

        // Emitir evento de transferencia de ganancias
        emit ProfitTransferred(owner(), profit);
    }

    function calculateDynamicLoanAmount(
        address tokenIn,
        address tokenOut
    ) internal view returns (uint256) {
        uint256 price = getTokenPrice(tokenIn, tokenOut, 1e18, 1);
        uint256 flashLoanAmount = (price * 1e18) / 100;
        return flashLoanAmount;
    }

    function getTokenPrice(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 slippageTolerance
    ) internal view returns (uint256) {
        address[] memory path = new address[](2);
        path[0] = tokenIn;
        path[1] = tokenOut;

        uint256[] memory amountsOut = uRouter.getAmountsOut(amountIn, path);
        uint256 amountOutMin = amountsOut[1] -
            ((amountsOut[1] * slippageTolerance) / 100);

        return amountOutMin;
    }
}
