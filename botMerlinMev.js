// -- HANDLE INITIAL SETUP -- //
require('./helpers/server');
require("dotenv").config();

const ethers = require("ethers");
const { FlashbotsBundleProvider } = require('@flashbots/ethers-provider-bundle');
const config = require('./config.json');
const {
    getTokenAndContract,
    getPairContract,
    getReserves,
    calculatePrice,
    simulate
} = require('./helpers/helpers');
const {
    provider,
    uFactory,
    uRouter,
    sFactory,
    sRouter,
    qRouter,
    aRouter,
    arbitrage
} = require('./helpers/initialization');

// -- ENVIRONMENT VARIABLES -- //
const arbFor = process.env.ARB_FOR; // WETH
const arbAgainst = process.env.ARB_AGAINST; // WMATIC
const units = process.env.UNITS; // Decimal precision
const difference = parseFloat(process.env.PRICE_DIFFERENCE);
const gasLimit = parseInt(process.env.GAS_LIMIT);
const gasPriceCap = ethers.utils.parseUnits(process.env.GAS_PRICE_CAP, 'gwei');

// -- MARLIN MEV SETUP FOR POLYGON -- //
const flashbotsEndpoint = 'https://bor.txrelay.marlin.org/';
const flashbotsSigningKey = process.env.FLASHBOTS_SIGNING_KEY;

const main = async () => {
    const baseProvider = new ethers.providers.JsonRpcProvider({ url: "https://polygon-rpc.com/" });
    const wallet = new ethers.Wallet(flashbotsSigningKey, baseProvider);
    const flashbotsProvider = new FlashbotsBundleProvider(baseProvider, wallet, flashbotsEndpoint, 137);

    const { token0Contract, token1Contract, token0, token1 } = await getTokenAndContract(arbFor, arbAgainst, provider);
    const sPair = await getPairContract(sFactory, token0.address, token1.address, provider);
    const qPair = await getPairContract(qFactory, token0.address, token1.address, provider);
    const aPair = await getPairContract(aFactory, token0.address, token1.address, provider);
    const uPair = await getPairContract(uFactory, token0.address, token1.address, provider);

    // Event listener for arbitrage opportunities
    sPair.on('Swap', async () => {
        const priceDifference = await checkPrice(sPair, qPair, aPair, uPair);
        console.log(`Price difference: ${priceDifference}%`);
        
        if (Math.abs(priceDifference) >= difference) {
            const routerPath = determineDirection(priceDifference);
            const profitability = await determineProfitability(routerPath, token0Contract, token1Contract);
            if (profitability) {
                console.log("Executing trade...");
                await executeTradeWithFlashbots(flashbotsProvider, routerPath, token0Contract, token1Contract,[sPair, qPair, aPair, uPair]);
            }
        }
    });

    console.log("Listening for arbitrage opportunities...");
};

async function checkPrice(sPair, qPair, aPair, uPair) {
  const [sPrice, qPrice, aPrice, uPrice] = await Promise.all([
      calculatePrice(sPair),
      calculatePrice(qPair),
      calculatePrice(aPair),
      calculatePrice(uPair)
  ]);

  // Log prices for debugging purposes
  console.log(`Prices: Sushiswap: ${sPrice}, Quickswap: ${qPrice}, Apeswap: ${aPrice}, Uniswap: ${uPrice}`);

  // Determine the best arbitrage route based on price differences
  const priceDifferences = [
      { name: 'Sushiswap to Quickswap', value: (sPrice - qPrice) / qPrice * 100, route: [sRouter, qRouter]},
      { name: 'Sushiswap to Apeswap', value: (sPrice - aPrice) / aPrice * 100, route: [sRouter, aRouter]},
      { name: 'Sushiswap to Uniswap', value: (sPrice - uPrice) / uPrice * 100, route: [sRouter, uRouter]},
      { name: 'Quickswap to Apeswap', value: (qPrice - aPrice) / aPrice * 100, route: [qRouter, aRouter]},
      { name: 'Quickswap to Uniswap', value: (qPrice - uPrice) / uPrice * 100, route: [qRouter, uRouter]},
      { name: 'Apeswap to Uniswap', value: (aPrice - uPrice) / uPrice * 100, route: [aRouter, uRouter]}
  ];

  // Sort by absolute value of price differences to find the most profitable
  const bestOpportunity = priceDifferences.sort((a, b) => Math.abs(b.value) - Math.abs(a.value))[0];

  console.log(`Best arbitrage opportunity is from ${bestOpportunity.name} with a difference of ${bestOpportunity.value.toFixed(2)}%`);

  return bestOpportunity; // Return the most profitable arbitrage opportunity
}


function determineDirection(priceDifference) {
    return priceDifference > 0 ? [sRouter, qRouter, aRouter, uRouter] : [uRouter, aRouter, qRouter, sRouter];
}

async function determineProfitability(routerPath, token0Contract, token1Contract) {
  const reservesBefore = await getReserves(routerPath[0]);
  console.log(`Reserves before trade: ${reservesBefore}`);

  const simulated = await simulate(ethers.utils.parseUnits('1', 'ether'), routerPath, token0Contract, token1Contract);
  console.log(`Simulation results: ${JSON.stringify(simulated)}`);

  const reservesAfter = await getReserves(routerPath[routerPath.length - 1]);
  console.log(`Reserves after trade: ${reservesAfter}`);

  return simulated.amountOut > simulated.amountIn;
}

// --- Weighted Average Flash Loan Amount Calculation --- //
async function calculateWeightedFlashLoanAmount(pairs) {
    let totalLiquidity = ethers.BigNumber.from(0);
    let weightedLoanAmount = ethers.BigNumber.from(0);

    for (const pair of pairs) {
        const reserves = await getReserves(pair);
        const token0Reserve = reserves[0]; // Assuming token0 is the asset you want to use for the flash loan

        const loanAmount = token0Reserve.div(10); // Use 10% of the available reserves

        // Accumulate the total liquidity and weighted loan amount
        totalLiquidity = totalLiquidity.add(token0Reserve);
        weightedLoanAmount = weightedLoanAmount.add(loanAmount.mul(token0Reserve));
    }

    // Calculate the weighted average loan amount
    const averageLoanAmount = weightedLoanAmount.div(totalLiquidity);
    
    console.log(`Calculated weighted average flash loan amount: ${ethers.utils.formatUnits(averageLoanAmount, 'ether')} ETH`);
    return averageLoanAmount;
}

async function executeTradeWithFlashbots(flashbotsProvider, routerPath, token0Contract, token1Contract, pairs) {
    const gasPrice = await getGasPrice();

   // --- Dynamic Calculation of Flash Loan Amount Using Weighted Average --- //
   const flashLoanAmount = await calculateWeightedFlashLoanAmount(pairs); // Use the new weighted average function


    const transaction = await arbitrage.populateTransaction.executeTrade(
        token0Contract.address,
        token1Contract.address,
        flashLoanAmount,
        { gasLimit, gasPrice }
    );

    const signedTransaction = await wallet.signTransaction(transaction);
    const bundle = [{ signedTransaction }];
    const blockNumber = await provider.getBlockNumber();
    const response = await flashbotsProvider.sendRawBundle(bundle, blockNumber + 1);
    console.log('Flashbots response:', response);
}

async function getGasPrice() {
    const currentGasPrice = await provider.getGasPrice();
    return currentGasPrice.gt(gasPriceCap) ? gasPriceCap : currentGasPrice;
}

setInterval(checkPrices, 10000);  // Check every 10 seconds


main().catch(console.error);
