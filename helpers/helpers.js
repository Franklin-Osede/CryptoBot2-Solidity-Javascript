const ethers = require("ethers");
const Big = require("big.js");

/**
 * This file could be used for adding functions you
 * may need to call multiple times or as a way to
 * abstract logic from bot.js. Feel free to add
 * in your own functions you desire here!
 */

const IUniswapV2Pair = require("@uniswap/v2-core/build/IUniswapV2Pair.json");


// Get token information and contract
async function getTokenAndContract(_token0Address, _token1Address, _provider) {
    try {
        const token0Contract = new ethers.Contract(_token0Address, IERC20.abi, _provider);
        const token1Contract = new ethers.Contract(_token1Address, IERC20.abi, _provider);

        const token0 = {
            address: _token0Address,
            decimals: 18,
            symbol: await token0Contract.symbol(),
            name: await token0Contract.name(),
        };

        const token1 = {
            address: _token1Address,
            decimals: 18,
            symbol: await token1Contract.symbol(),
            name: await token1Contract.name(),
        };

        return { success: true, data: { token0Contract, token1Contract, token0, token1 } };
    } catch (error) {
        console.error("Failed to get token contracts:", error);
        return { success: false, error: error.message };
    }
}

// Get pair address
async function getPairAddress(_V2Factory, _token0, _token1) {
    const pairAddress = await _V2Factory.getPair(_token0, _token1);
    return pairAddress;
}

// Get pair contract
async function getPairContract(_V2Factory, _token0, _token1, _provider) {
    const pairAddress = await getPairAddress(_V2Factory, _token0, _token1);
    const pairContract = new ethers.Contract(pairAddress, IUniswapV2Pair.abi, _provider);
    return pairContract;
}

// Get reserves from pair contract
async function getReserves(_pairContract) {
    const reserves = await _pairContract.getReserves();
    return [reserves.reserve0, reserves.reserve1];
}

// Calculate price based on reserves
async function calculatePrice(_pairContract, _token0, _token1) {
    try {
        const [reserve0, reserve1] = await getReserves(_pairContract);
        const price =
            _token0.address.toLowerCase() === (await _pairContract.token0()).toLowerCase()
                ? Big(reserve0).div(Big(reserve1))
                : Big(reserve1).div(Big(reserve0));
        return price;
    } catch (error) {
        console.error("Failed to calculate price:", error);
        throw error;
    }
}

// Calculate price differences between exchanges
async function calculateDifference(prices) {
    let differences = {};
    const exchangeNames = Object.keys(prices);

    for (let i = 0; i < exchangeNames.length; i++) {
        for (let j = i + 1; j < exchangeNames.length; j++) {
            let name1 = exchangeNames[i];
            let name2 = exchangeNames[j];
            let price1 = parseFloat(prices[name1]);
            let price2 = parseFloat(prices[name2]);

            let difference = ((price2 - price1) / price1) * 100;
            differences[`${name1}_to_${name2}`] = difference.toFixed(2);
            differences[`${name2}_to_${name1}`] = (-difference).toFixed(2);
        }
    }

    return differences;
}

// Check liquidity in the pool
async function checkLiquidity(pairContract, minLiquidity) {
    try {
        const [reserve0, reserve1] = await getReserves(pairContract);
        const liquidity = Big(reserve0).plus(Big(reserve1));

        if (liquidity.lt(Big(minLiquidity))) {
            throw new Error('Insufficient liquidity in the pool');
        }

        return { success: true };
    } catch (error) {
        console.error("Liquidity check failed:", error);
        return { success: false, error: error.message };
    }
}

// Simulate trade with slippage and profit control
async function simulate(_amount, _routerPath, _token0, _token1, slippageTolerance = 0.5, minProfit = 0) {
    try {
        const trade1 = await _routerPath[0].getAmountsOut(_amount, [_token0.address, _token1.address]);
        const trade2 = await _routerPath[1].getAmountsOut(trade1[1], [_token1.address, _token0.address]);

        const amountIn = ethers.formatUnits(trade1[0], 'ether');
        const amountOut = ethers.formatUnits(trade2[1], 'ether');

        // Slippage control: calculate minimum acceptable output
        const minAmountOut = Big(amountIn).times(1 - slippageTolerance / 100); // e.g., 0.5% slippage
        if (Big(amountOut).lt(minAmountOut)) {
            throw new Error('Slippage too high, trade reverted');
        }

        // Calculate profit and ensure it's above the minimum required
        const profit = Big(amountOut).minus(amountIn);
        if (profit.lt(Big(minProfit))) {
            throw new Error('Not enough profit from arbitrage');
        }

        return { success: true, amountIn, amountOut, profit: profit.toFixed(18) };
    } catch (error) {
        console.error("Simulation failed:", error);
        return { success: false, error: error.message };
    }
}

module.exports = {
    getTokenAndContract,
    getPairAddress,
    getPairContract,
    getReserves,
    calculatePrice,
    calculateDifference,
    simulate,
    checkLiquidity // Exported the liquidity check function
};
