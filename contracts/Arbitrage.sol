// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.19;

import "@balancer-labs/v2-interfaces/contracts/vault/IVault.sol";
import "@balancer-labs/v2-interfaces/contracts/vault/IFlashLoanRecipient.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";

contract Arbitrage is IFlashLoanRecipient {
    IVault private constant vault =
        IVault(0xBA12222222228d8Ba445958a75a0704d566BF2C8); // Balancer Vault

    IUniswapV2Router02 public immutable sRouter; // SushiSwap
    IUniswapV2Router02 public immutable uRouter; // Uniswap

    address public owner;

    constructor(
        address _sRouter, // SushiSwap
        address _uRouter // Uniswap
    ) {
        sRouter = IUniswapV2Router02(_sRouter);
        uRouter = IUniswapV2Router02(_uRouter);
        owner = msg.sender;
    }

    function executeTrade(
        address _token0,
        address _token1,
        uint256 _flashAmount
    ) external {
        bytes memory data = abi.encode(_token0, _token1);

        // Token a tomar en préstamo (WBTC o WETH)
        IERC20[] memory tokens = new IERC20[](1);
        tokens[0] = IERC20(_token0);

        // Cantidad del préstamo
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = _flashAmount;

        vault.flashLoan(this, tokens, amounts, data);
    }

    function receiveFlashLoan(
        IERC20[] memory tokens, // Parámetro utilizado pero no modificado
        uint256[] memory amounts, // Monto del préstamo flash
        uint256[] memory feeAmounts, // Tarifa del préstamo flash
        bytes memory userData // Datos adicionales
    ) external override {
        require(
            msg.sender == address(vault),
            "Only the vault can call this function"
        );

        uint256 flashAmount = amounts[0];

        // Decodificar las direcciones de los tokens (por ejemplo, WBTC y WETH)
        (address token0, address token1) = abi.decode(
            userData,
            (address, address)
        );

        // Crear un array para la ruta de intercambio
        address[] memory path = new address[](2);
        // Array para las rutas del intercambio

        // Paso 1: Intercambiar token0 (WBTC) por token1 (WETH) en Uniswap
        path[0] = token0; // WBTC
        path[1] = token1; // WETH
        _swapOnUniswap(path, flashAmount, 0);

        // Paso 2: Intercambiar token1 (WETH) por token0 (WBTC) en SushiSwap
        uint256 amountToken1 = IERC20(token1).balanceOf(address(this)); // Cantidad de WETH recibida
        path[0] = token1; // WETH
        path[1] = token0; // WBTC
        _swapOnSushiswap(path, amountToken1, flashAmount);

        // Repagar el préstamo flash + tarifa usando feeAmounts
        uint256 repaymentAmount = flashAmount + feeAmounts[0]; // Se usa feeAmounts aquí
        IERC20(token0).transfer(address(vault), repaymentAmount);

        // Transferir cualquier token0 (WBTC) restante al propietario como ganancia
        IERC20(token0).transfer(owner, IERC20(token0).balanceOf(address(this)));
    }

    // Función interna para intercambio en Uniswap
    function _swapOnUniswap(
        address[] memory _path, // Ruta del intercambio
        uint256 _amountIn, // Cantidad de entrada
        uint256 _amountOut // Mínima cantidad de salida
    ) internal {
        // Aprobar la transferencia de tokens al router de Uniswap
        require(
            IERC20(_path[0]).approve(address(uRouter), _amountIn),
            "Uniswap approval failed."
        );

        // Realizar el intercambio en Uniswap
        uRouter.swapExactTokensForTokens(
            _amountIn, // Cantidad de tokens a enviar
            _amountOut, // Mínimo de tokens de salida a recibir
            _path, // Ruta de intercambio
            address(this), // Dirección receptora
            block.timestamp + 1200 // Límite de tiempo
        );
    }

    // Función interna para intercambio en SushiSwap
    function _swapOnSushiswap(
        address[] memory _path, // Ruta del intercambio
        uint256 _amountIn, // Cantidad de entrada
        uint256 _amountOut // Mínima cantidad de salida
    ) internal {
        // Aprobar la transferencia de tokens al router de SushiSwap
        require(
            IERC20(_path[0]).approve(address(sRouter), _amountIn),
            "Sushiswap approval failed."
        );

        // Realizar el intercambio en SushiSwap
        sRouter.swapExactTokensForTokens(
            _amountIn, // Cantidad de tokens a enviar
            _amountOut, // Mínimo de tokens de salida a recibir
            _path, // Ruta de intercambio
            address(this), // Dirección receptora
            block.timestamp + 1200 // Límite de tiempo
        );
    }
}
