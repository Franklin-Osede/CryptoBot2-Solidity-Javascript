const ethers = require("ethers")
const Big = require('big.js')

/**
 * This file could be used for adding functions you
 * may need to call multiple times or as a way to
 * abstract logic from bot.js. Feel free to add
 * in your own functions you desire here!
 */

const IUniswapV2Pair = require("@uniswap/v2-core/build/IUniswapV2Pair.json")
const IERC20 = require('@openzeppelin/contracts/build/contracts/ERC20.json')

async function getTokenAndContract(_token0Address, _token1Address, _provider) {
    try{ 
    const token0Contract = new ethers.Contract(_token0Address, IERC20.abi, _provider)
    const token1Contract = new ethers.Contract(_token1Address, IERC20.abi, _provider)

    const token0 = {
        address: _token0Address,
        decimals: 18,
        symbol: await token0Contract.symbol(),
        name: await token0Contract.name()
    }

    const token1 = {
        address: _token1Address,
        decimals: 18,
        symbol: await token1Contract.symbol(),
        name: await token1Contract.name()
    }

    return { success: true, data: { token0Contract, token1Contract, token0, token1 } };
    } catch (error) {
        console.error("Failed to get token contracts:", error);
        return { success: false, error: error.message };
    }
} 

async function getPairAddress(_V2Factory, _token0, _token1) {
    const pairAddress = await _V2Factory.getPair(_token0, _token1)
    return pairAddress
}

async function getPairContract(_V2Factory, _token0, _token1, _provider) {
    const pairAddress = await getPairAddress(_V2Factory, _token0, _token1)
    const pairContract = new ethers.Contract(pairAddress, IUniswapV2Pair.abi, _provider)
    return pairContract
}

async function getReserves(_pairContract) {
    const reserves = await _pairContract.getReserves()
    return [reserves.reserve0, reserves.reserve1]
}

async function calculatePrice(_pairContract, _token0, _token1) {
    try {
        const [reserve0, reserve1] = await getReserves(_pairContract);
        // Ensure correct price calculation based on token order
        const price = _token0.address.toLowerCase() === (await _pairContract.token0()).toLowerCase()
            ? Big(reserve0).div(Big(reserve1))
            : Big(reserve1).div(Big(reserve0));
        return price;
    } catch (error) {
        console.error("Failed to calculate price:", error);
        throw error;
    }
}


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

async function simulate(_amount, _routerPath, _token0, _token1) {
    const trade1 = await _routerPath[0].getAmountsOut(_amount, [_token0.address, _token1.address])
    const trade2 = await _routerPath[1].getAmountsOut(trade1[1], [_token1.address, _token0.address])

    const amountIn = ethers.formatUnits(trade1[0], 'ether')
    const amountOut = ethers.formatUnits(trade2[1], 'ether')

    return { amountIn, amountOut }
}

module.exports = {
    getTokenAndContract,
    getPairAddress,
    getPairContract,
    getReserves,
    calculatePrice,
    calculateDifference,
    simulate
}