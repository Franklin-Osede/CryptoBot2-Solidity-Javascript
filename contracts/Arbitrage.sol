// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.19;

// Importamos las interfaces de Uniswap y Balancer, junto con Ownable e IERC20
import "@balancer-labs/v2-interfaces/contracts/vault/IVault.sol";
import "@balancer-labs/v2-interfaces/contracts/vault/IFlashLoanRecipient.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract Arbitrage is IFlashLoanRecipient, Ownable {
    IVault private constant VAULT =
        IVault(0xBA12222222228d8Ba445958a75a0704d566BF2C8); // Balancer Vault

    IUniswapV2Router02 public immutable sRouter; // SushiSwap
    IUniswapV2Router02 public immutable uRouter; // Uniswap

    constructor(
        address _sRouter, // SushiSwap
        address _uRouter // Uniswap
    ) {
        sRouter = IUniswapV2Router02(_sRouter);
        uRouter = IUniswapV2Router02(_uRouter);
    }

    // Function to execute arbitrage, now owner-protected
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

        // Solicitar el flash loan desde el Balancer Vault
        VAULT.flashLoan(this, tokens, amounts, data);
    }

    // Function that receives the flash loan and performs the arbitrage
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

        // Decode the user data
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

        uint256 gasStart = gasleft(); // Start tracking gas usage

        if (flashLoanToken == token0) {
            // Start with token0, swap token0 to token1 on Uniswap
            uint256 token1Amount = _swapOnUniswap(
                token0,
                token1,
                flashAmount,
                slippageTolerance
            );

            // Check if trade is profitable
            uint256 gasUsed = gasStart - gasleft();
            uint256 gasCost = gasUsed * tx.gasprice;

            require(
                token1Amount >
                    flashAmount + feeAmounts[0] + minProfit + gasCost,
                "Trade is not profitable after gas fees"
            );

            // Swap token1 to token0 on SushiSwap
            uint256 token0Amount = _swapOnSushiswap(
                token1,
                token0,
                token1Amount,
                slippageTolerance
            );

            // Repay flash loan using token0Amount
            _repayAndProfit(token0, token0Amount, feeAmounts[0]);
        } else if (flashLoanToken == token1) {
            // Start with token1, swap token1 to token0 on Uniswap
            uint256 token0Amount = _swapOnUniswap(
                token1,
                token0,
                flashAmount,
                slippageTolerance
            );

            // Swap token0 to token1 on SushiSwap
            uint256 token1Amount = _swapOnSushiswap(
                token0,
                token1,
                token0Amount,
                slippageTolerance
            );

            // Calculate gas cost and include it in profitability check
            uint256 gasUsed = gasStart - gasleft();
            uint256 gasCost = gasUsed * tx.gasprice;

            // Check if trade is profitable after accounting for gas fees
            require(
                token1Amount >
                    flashAmount + feeAmounts[0] + minProfit + gasCost,
                "Trade is not profitable after gas fees"
            );

            // Repay flash loan using token0Amount
            _repayAndProfit(token1, token1Amount, feeAmounts[0]);
        } else {
            revert("Unsupported flash loan token");
        }
    }

    // Internal function for swapping on Uniswap
    function _swapOnUniswap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 slippageTolerance
    ) internal returns (uint256) {
        // Inicializar el array 'path'
        address[] memory path = new address[](2);
        path[0] = tokenIn;
        path[1] = tokenOut;

        // Obtener la cantidad mínima de salida basada en la tasa de intercambio de Uniswap
        uint256[] memory amountsOut = uRouter.getAmountsOut(amountIn, path);
        uint256 amountOutMin = amountsOut[1] -
            ((amountsOut[1] * slippageTolerance) / 100);

        // Aprobar Uniswap para gastar tokens
        IERC20(tokenIn).approve(address(uRouter), type(uint256).max); // Se aprueba el máximo disponible

        // Ejecutar el intercambio en Uniswap
        uint256[] memory amounts = uRouter.swapExactTokensForTokens(
            amountIn,
            amountOutMin,
            path,
            address(this),
            block.timestamp + 1200
        );

        return amounts[1]; // Retornar la cantidad de salida
    }

    // Internal function for swapping on SushiSwap
    function _swapOnSushiswap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 slippageTolerance
    ) internal returns (uint256) {
        // Inicializar el array 'path'
        address[] memory path = new address[](2);
        path[0] = tokenIn;
        path[1] = tokenOut;

        // Obtener la cantidad mínima de salida basada en la tasa de intercambio de SushiSwap
        uint256[] memory amountsOut = sRouter.getAmountsOut(amountIn, path);
        uint256 amountOutMin = amountsOut[1] -
            ((amountsOut[1] * slippageTolerance) / 100);

        // Aprobar SushiSwap para gastar tokens
        IERC20(tokenIn).approve(address(sRouter), type(uint256).max); // Se aprueba el máximo disponible

        // Ejecutar el intercambio en SushiSwap
        uint256[] memory amounts = sRouter.swapExactTokensForTokens(
            amountIn,
            amountOutMin,
            path,
            address(this),
            block.timestamp + 1200
        );

        return amounts[1]; // Retornar la cantidad de salida
    }

    // Function to repay flash loan and transfer profit
    function _repayAndProfit(
        address repayToken,
        uint256 repayAmount, // Now using the swapped token amount to repay
        uint256 feeAmount
    ) internal {
        // Repagar el flash loan más la comisión
        uint256 repaymentAmount = repayAmount + feeAmount;
        IERC20(repayToken).transfer(address(VAULT), repaymentAmount);

        // Transferir las ganancias restantes al dueño del contrato
        uint256 profit = IERC20(repayToken).balanceOf(address(this));
        IERC20(repayToken).transfer(owner(), profit);
    }

    // Calculate the flash loan amount dynamically based on market conditions
    function calculateDynamicLoanAmount(
        address tokenIn,
        address tokenOut
    ) internal view returns (uint256) {
        uint256 price = getTokenPrice(tokenIn, tokenOut, 1e18, 1); // Ajustamos la llamada a getTokenPrice con los 4 parámetros
        uint256 flashLoanAmount = (price * 1e18) / 100; // Ejemplo: 1% del valor del token
        return flashLoanAmount;
    }

    function getTokenPrice(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 slippageTolerance
    ) internal view returns (uint256) {
        // Inicializar el array 'path' para obtener el precio a través de Uniswap
        address[] memory path = new address[](2);
        path[0] = tokenIn;
        path[1] = tokenOut;

        // Obtener las cantidades de salida para el monto de entrada a través de Uniswap
        uint256[] memory amountsOut = uRouter.getAmountsOut(amountIn, path);

        // Aplicar la tolerancia de slippage para obtener el precio mínimo de salida
        uint256 amountOutMin = amountsOut[1] -
            ((amountsOut[1] * slippageTolerance) / 100);

        // Retornar la cantidad mínima de salida como el precio estimado del token
        return amountOutMin;
    }
}
