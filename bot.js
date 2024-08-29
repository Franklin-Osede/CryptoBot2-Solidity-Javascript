// -- HANDLE INITIAL SETUP -- //
require('./helpers/server');
require("dotenv").config();

const ethers = require("ethers");
const { FlashbotsBundleProvider } = require('@flashbots/ethers-provider-bundle'); // Import Flashbots provider
const config = require('./config.json');
const { getTokenAndContract, getPairContract, getReserves, calculatePrice, simulate } = require('./helpers/helpers');
const { provider, uFactory, uRouter, sFactory, sRouter, qRouter, aRouter, arbitrage } = require('./helpers/initialization'); // Ensure all routers are imported

// -- .ENV VALUES HERE -- //
const arbFor = process.env.ARB_FOR; // This is the address of token we are attempting to arbitrage (WETH)
const arbAgainst = process.env.ARB_AGAINST; // WMATIC
const units = process.env.UNITS; // Used for price display/reporting
const difference = process.env.PRICE_DIFFERENCE;
const gasLimit = process.env.GAS_LIMIT;
const gasPriceCap = ethers.parseUnits(process.env.GAS_PRICE_CAP, 'gwei');

// Flashbots settings
const flashbotsEndpoint = process.env.FLASHBOTS_RELAY_ENDPOINT || 'https://relay.flashbots.net';
const flashbotsSigningKey = process.env.FLASHBOTS_RELAY_SIGNING_KEY;

let sPair, qPair, aPair, uPair, amount;
let isExecuting = false;

const main = async () => {
  // Set up Flashbots provider
  const flashbotsProvider = await FlashbotsBundleProvider.create(
    provider,
    new ethers.Wallet(flashbotsSigningKey),
    flashbotsEndpoint,
    'polygon' // Polygon network identifier
  );

  // Get token contracts and pair contracts
  const { token0Contract, token1Contract, token0, token1 } = await getTokenAndContract(arbFor, arbAgainst, provider);
  sPair = await getPairContract(sFactory, token0.address, token1.address, provider);
  qPair = await getPairContract(qRouter.factory, token0.address, token1.address, provider);
  aPair = await getPairContract(aRouter.factory, token0.address, token1.address, provider);
  uPair = await getPairContract(uFactory, token0.address, token1.address, provider);

  console.log(`sPair Address: ${await sPair.getAddress()}`);
  console.log(`qPair Address: ${await qPair.getAddress()}`);
  console.log(`aPair Address: ${await aPair.getAddress()}`);
  console.log(`uPair Address: ${await uPair.getAddress()}\n`);

  // Set up event listeners for price check
  sPair.on('Swap', async () => {
    if (!isExecuting) {
      isExecuting = true;

      const priceDifference = await checkPrice('Sushiswap', token0, token1);
      const routerPath = await determineDirection(priceDifference);

      if (!routerPath) {
        console.log(`No Arbitrage Currently Available\n`);
        console.log(`-----------------------------------------\n`);
        isExecuting = false;
        return;
      }

      const isProfitable = await determineProfitability(routerPath, token0Contract, token0, token1);

      if (!isProfitable) {
        console.log(`No Arbitrage Currently Available\n`);
        console.log(`-----------------------------------------\n`);
        isExecuting = false;
        return;
      }

      const receipt = await executeTradeWithFlashbots(flashbotsProvider, routerPath, token0Contract, token1Contract);

      isExecuting = false;
    }
  });

  console.log("Waiting for swap event...");
};

// Function to check price differences
const checkPrice = async (_exchange, _token0, _token1) => {
  isExecuting = true;

  console.log(`Swap Initiated on ${_exchange}, Checking Price...\n`);

  const currentBlock = await provider.getBlockNumber();

  const sPrice = await calculatePrice(sPair);
  const qPrice = await calculatePrice(qPair);
  const aPrice = await calculatePrice(aPair);
  const uPrice = await calculatePrice(uPair);

  const sFPrice = Number(sPrice).toFixed(units);
  const qFPrice = Number(qPrice).toFixed(units);
  const aFPrice = Number(aPrice).toFixed(units);
  const uFPrice = Number(uPrice).toFixed(units);
  const priceDifference = (((sFPrice - uFPrice) / uFPrice) * 100).toFixed(2);

  console.log(`Current Block: ${currentBlock}`);
  console.log(`-----------------------------------------`);
  console.log(`SUSHISWAP   | ${_token1.symbol}/${_token0.symbol}\t | ${sFPrice}`);
  console.log(`QUICKSWAP   | ${_token1.symbol}/${_token0.symbol}\t | ${qFPrice}`);
  console.log(`APESWAP     | ${_token1.symbol}/${_token0.symbol}\t | ${aFPrice}`);
  console.log(`UNISWAP     | ${_token1.symbol}/${_token0.symbol}\t | ${uFPrice}\n`);
  console.log(`Percentage Difference: ${priceDifference}%\n`);

  return priceDifference;
};

// Function to determine the arbitrage direction based on price difference
const determineDirection = async (_priceDifference) => {
  console.log(`Determining Direction...\n`);

  if (_priceDifference >= difference) {
    console.log(`Potential Arbitrage Direction:\n`);
    console.log(`Buy\t -->\t Sushiswap`);
    console.log(`Sell\t -->\t Quickswap`);
    console.log(`Buy\t -->\t Apeswap`);
    console.log(`Sell\t -->\t Uniswap\n`);
    return [sRouter, qRouter, aRouter, uRouter];
  } else if (_priceDifference <= -(difference)) {
    console.log(`Potential Arbitrage Direction:\n`);
    console.log(`Buy\t -->\t Uniswap`);
    console.log(`Sell\t -->\t Apeswap`);
    console.log(`Buy\t -->\t Quickswap`);
    console.log(`Sell\t -->\t Sushiswap\n`);
    return [uRouter, aRouter, qRouter, sRouter];
  } else {
    return null;
  }
};

// Function to determine if the arbitrage trade is profitable
const determineProfitability = async (_routerPath, _token0Contract, _token0, _token1) => {
  console.log(`Determining Profitability...\n`);

  const sReserves = await getReserves(sPair);
  const qReserves = await getReserves(qPair);
  const aReserves = await getReserves(aPair);
  const uReserves = await getReserves(uPair);

  let minAmount;

  if (sReserves[0] > uReserves[0]) {
    minAmount = BigInt(uReserves[0]) / BigInt(2);
  } else {
    minAmount = BigInt(sReserves[0]) / BigInt(2);
  }

  try {
    const estimate = await _routerPath[0].getAmountsIn(minAmount, [_token0.address, _token1.address]);
    const result1 = await _routerPath[1].getAmountsOut(estimate[1], [_token1.address, _token0.address]);
    const result2 = await _routerPath[2].getAmountsOut(result1[1], [_token0.address, _token1.address]);
    const result3 = await _routerPath[3].getAmountsOut(result2[1], [_token1.address, _token0.address]);

    console.log(`Estimated amount of ${_token0.symbol} needed to buy enough ${_token1.symbol} on ${_routerPath[0].address}\t\t| ${ethers.formatUnits(estimate[0], 'ether')}`);
    console.log(`Estimated amount of ${_token0.symbol} returned after swapping ${_token1.symbol} on ${_routerPath[1].address}\t| ${ethers.formatUnits(result1[1], 'ether')}`);
    console.log(`Estimated amount of ${_token0.symbol} returned after swapping ${_token0.symbol} on ${_routerPath[2].address}\t| ${ethers.formatUnits(result2[1], 'ether')}`);
    console.log(`Estimated amount of ${_token1.symbol} returned after swapping ${_token0.symbol} on ${_routerPath[3].address}\t| ${ethers.formatUnits(result3[1], 'ether')}\n`);

    const { amountIn, amountOut } = await simulate(estimate[0], _routerPath, _token0, _token1);
    const amountDifference = amountOut - amountIn;

    const gasPrice = await getGasPrice(); // Get dynamic gas price with cap
    const estimatedGasCost = gasLimit * gasPrice;

    const account = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

    const token0BalanceBefore = Number(ethers.formatUnits(await _token0Contract.balanceOf(account.address), 'ether'));
    const token0BalanceAfter = amountDifference + token0BalanceBefore;
    const token0BalanceDifference = token0BalanceAfter - token0BalanceBefore;

    const data = {
      [`${_token0.symbol} Balance BEFORE`]: token0BalanceBefore,
      [`${_token0.symbol} Balance AFTER`]: token0BalanceAfter,
      [`${_token0.symbol} Gained/Lost`]: token0BalanceDifference,
      '-': {},
      'Total Gained/Lost': token0BalanceDifference - estimatedGasCost
    };

    console.table(data);
    console.log();

    if (Number(amountOut) < Number(amountIn)) {
      return false;
    }

    amount = ethers.parseUnits(amountIn, 'ether');
    return true;

  } catch (error) {
    console.log(error);
    console.log(`\nError occurred while trying to determine profitability...\n`);
    console.log(`This can typically happen because of liquidity issues, see README for more information.\n`);
    return false;
  }
};

// Function to execute trade using Flashbots
const executeTradeWithFlashbots = async (flashbotsProvider, _routerPath, _token0Contract, _token1Contract) => {
  console.log(`Attempting Arbitrage with Flashbots...\n`);

  let startOnSushiswap;

  if (await _routerPath[0].getAddress() == await sRouter.getAddress()) {
    startOnSushiswap = true;
  } else {
    startOnSushiswap = false;
  }

  const account = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  const token0BalanceBefore = await _token0Contract.balanceOf(account.address);
  const ethBalanceBefore = await provider.getBalance(account.address);

  const gasPrice = await getGasPrice(); // Get dynamic gas price with cap

  const transaction = await arbitrage.populateTransaction.executeTrade(
    startOnSushiswap,
    await _token0Contract.getAddress(),
    await _token1Contract.getAddress(),
    amount,
    { gasLimit: process.env.GAS_LIMIT, gasPrice: gasPrice }
  );

  const signedTransactions = await flashbotsProvider.signBundle([
    {
      signer: account,
      transaction: transaction
    }
  ]);

  const response = await flashbotsProvider.sendRawBundle(signedTransactions, await provider.getBlockNumber() + 1);

  if ('error' in response) {
    console.warn(`Error: ${response.error.message}`);
    return;
  }

  const receipt = await response.wait();
  if (receipt === 0) {
    console.log('Transaction not included in block.');
  } else {
    console.log('Transaction included in block:', receipt);
  }

  const token0BalanceAfter = await _token0Contract.balanceOf(account.address);
  const ethBalanceAfter = await provider.getBalance(account.address);

  const token0BalanceDifference = token0BalanceAfter - token0BalanceBefore;
  const ethBalanceDifference = ethBalanceBefore - ethBalanceAfter;

  const data = {
    'ETH Balance Before': ethers.formatUnits(ethBalanceBefore, 'ether'),
    'ETH Balance After': ethers.formatUnits(ethBalanceAfter, 'ether'),
    'ETH Spent (gas)': ethers.formatUnits(ethBalanceDifference.toString(), 'ether'),
    '-': {},
    [`${_token0Contract.symbol} Balance BEFORE`]: ethers.formatUnits(token0BalanceBefore, 'ether'),
    [`${_token0Contract.symbol} Balance AFTER`]: ethers.formatUnits(token0BalanceAfter, 'ether'),
    [`${_token0Contract.symbol} Gained/Lost`]: ethers.formatUnits(token0BalanceDifference.toString(), 'ether'),
    '-': {},
    'Total Gained/Lost': `${ethers.formatUnits((token0BalanceDifference - ethBalanceDifference).toString(), 'ether')} ${_token0Contract.symbol}`
  };

  console.table(data);
};

// Function to get dynamic gas price with cap
const getGasPrice = async () => {
  const gasPrice = await provider.getGasPrice(); // Fetch the current gas price from the provider
  return gasPrice.gt(gasPriceCap) ? gasPriceCap : gasPrice; // Compare the fetched gas price with the cap and return the lower value
};

main();
