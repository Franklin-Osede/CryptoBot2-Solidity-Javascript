// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.19;


import "@balancer-labs/v2-interfaces/contracts/vault/IVault.sol";
import "@balancer-labs/v2-interfaces/contracts/vault/IFlashLoanRecipient.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";

contract Arbitrage is IFlashLoanRecipient {
    IVault private constant vault =
        IVault(0xBA12222222228d8Ba445958a75a0704d566BF2C8);

    IUniswapV2Router02 public immutable sRouter; // Sushiswap
    IUniswapV2Router02 public immutable qRouter; // Quickswap
    IUniswapV2Router02 public immutable aRouter; // Apeswap
    IUniswapV2Router02 public immutable uRouter; // Uniswap

    address public owner;

    constructor(
        address _sRouter, // Sushiswap
        address _qRouter, // Quickswap
        address _aRouter, // Apeswap
        address _uRouter  // Uniswap
    ) {
        sRouter = IUniswapV2Router02(_sRouter);
        qRouter = IUniswapV2Router02(_qRouter);
        aRouter = IUniswapV2Router02(_aRouter);
        uRouter = IUniswapV2Router02(_uRouter);
        owner = msg.sender;
    }

    function executeTrade(
        address _token0,
        address _token1,
        uint256 _flashAmount
    ) external {
        bytes memory data = abi.encode(_token0, _token1);

        // Token to flash loan, by default we are flash loaning 1 token.
        IERC20[] memory tokens = new IERC20[](1);
        tokens[0] = IERC20(_token0);

        // Flash loan amount.
        uint256[] memory amounts = new uint256[](1);
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

        // Decoding userData to get token addresses
        (address token0, address token1) = abi.decode(
            userData,
            (address, address)
        );

        // Use the money here!
        address[] memory path = new address[](2);

        // Step 1: Swap on Uniswap (buy token1 with token0)
        path[0] = token0;
        path[1] = token1;
        _swapOnUniswap(path, flashAmount, 0);

        // Step 2: Swap on Quickswap (swap token1 for token0)
        uint256 amountToken1 = IERC20(token1).balanceOf(address(this));
        path[0] = token1;
        path[1] = token0;
        _swapOnQuickswap(path, amountToken1, 0);

        // Step 3: Swap on Apeswap (swap token0 for token1)
        uint256 amountToken0 = IERC20(token0).balanceOf(address(this));
        path[0] = token0;
        path[1] = token1;
        _swapOnApeswap(path, amountToken0, 0);

        // Step 4: Swap on Sushiswap (swap token1 for token0)
        amountToken1 = IERC20(token1).balanceOf(address(this));
        path[0] = token1;
        path[1] = token0;
        _swapOnSushiswap(path, amountToken1, flashAmount);

        // Repay the flash loan
        IERC20(token0).transfer(address(vault), flashAmount);

        // Transfer remaining token0 to the owner as profit
        IERC20(token0).transfer(owner, IERC20(token0).balanceOf(address(this)));
    }

    // Internal function for swapping on Uniswap
    function _swapOnUniswap(
        address[] memory _path,
        uint256 _amountIn,
        uint256 _amountOut
    ) internal {
        // Approve the token transfer to the Uniswap router
        require(
            IERC20(_path[0]).approve(address(uRouter), _amountIn),
            "Uniswap approval failed."
        );

        // Perform the token swap on Uniswap
        uRouter.swapExactTokensForTokens(
            _amountIn,       // Amount of input tokens to send
            _amountOut,      // Minimum amount of output tokens to receive
            _path,           // Swap path (array of token addresses)
            address(this),   // Recipient address
            block.timestamp + 1200  // Deadline for the swap
        );
    }

    // Internal function for swapping on Sushiswap
    function _swapOnSushiswap(
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
            _amountIn,       // Amount of input tokens to send
            _amountOut,      // Minimum amount of output tokens to receive
            _path,           // Swap path (array of token addresses)
            address(this),   // Recipient address
            block.timestamp + 1200  // Deadline for the swap
        );
    }

    // Internal function for swapping on Quickswap
    function _swapOnQuickswap(
        address[] memory _path,
        uint256 _amountIn,
        uint256 _amountOut
    ) internal {
        // Approve the token transfer to the Quickswap router
        require(
            IERC20(_path[0]).approve(address(qRouter), _amountIn),
            "Quickswap approval failed."
        );

        // Perform the token swap on Quickswap
        qRouter.swapExactTokensForTokens(
            _amountIn,       // Amount of input tokens to send
            _amountOut,      // Minimum amount of output tokens to receive
            _path,           // Swap path (array of token addresses)
            address(this),   // Recipient address
            block.timestamp + 1200  // Deadline for the swap
        );
    }

    // Internal function for swapping on Apeswap
    function _swapOnApeswap(
        address[] memory _path,
        uint256 _amountIn,
        uint256 _amountOut
    ) internal {
        // Approve the token transfer to the Apeswap router
        require(
            IERC20(_path[0]).approve(address(aRouter), _amountIn),
            "Apeswap approval failed."
        );

        // Perform the token swap on Apeswap
        aRouter.swapExactTokensForTokens(
            _amountIn,       // Amount of input tokens to send
            _amountOut,      // Minimum amount of output tokens to receive
            _path,           // Swap path (array of token addresses)
            address(this),   // Recipient address
            block.timestamp + 1200  // Deadline for the swap
        );
    }
}
