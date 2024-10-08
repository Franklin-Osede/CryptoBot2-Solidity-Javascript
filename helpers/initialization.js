const hre = require("hardhat");
require("dotenv").config();

// Import the ABIs for Uniswap V2 Router and Factory
const IUniswapV2Router02 = require('@uniswap/v2-periphery/build/IUniswapV2Router02.json');
const IUniswapV2Factory = require("@uniswap/v2-core/build/IUniswapV2Factory.json");

// Import ERC20 ABI for token interaction (WBTC, WETH)
const IERC20 = require("@openzeppelin/contracts/build/contracts/ERC20.json").abi;

let provider;

// Check if we are using a local or remote provider
if (config.PROJECT_SETTINGS.isLocal) {
  provider = new hre.ethers.providers.JsonRpcProvider(`http://127.0.0.1:8545/`);
} else {
  provider = new hre.ethers.providers.JsonRpcProvider(`https://polygon-mainnet.infura.io/v3/${process.env.INFURA_API_KEY}`);
}

// Initialize Uniswap contracts
const uFactory = new hre.ethers.Contract(config.UNISWAP.FACTORY_ADDRESS, IUniswapV2Factory.abi, provider);
const uRouter = new hre.ethers.Contract(config.UNISWAP.V2_ROUTER_02_ADDRESS, IUniswapV2Router02.abi, provider);

// Initialize Sushiswap contracts
const sFactory = new hre.ethers.Contract(config.SUSHISWAP.FACTORY_ADDRESS, IUniswapV2Factory.abi, provider);
const sRouter = new hre.ethers.Contract(config.SUSHISWAP.V2_ROUTER_02_ADDRESS, IUniswapV2Router02.abi, provider);

// Initialize WBTC and WETH contracts (assuming addresses are in config)
const WBTC = new hre.ethers.Contract(config.TOKENS.WBTC_ADDRESS, IERC20, provider);
const WETH = new hre.ethers.Contract(config.TOKENS.WETH_ADDRESS, IERC20, provider);

// Arbitrage contract initialization
const IArbitrage = require('../artifacts/contracts/Arbitrage.sol/Arbitrage.json');
const arbitrage = new hre.ethers.Contract(config.PROJECT_SETTINGS.ARBITRAGE_ADDRESS, IArbitrage.abi, provider);

// Helper function to check balance of WBTC and WETH
async function checkBalances(walletAddress) {
  const wbtcBalance = await WBTC.balanceOf(walletAddress);
  const wethBalance = await WETH.balanceOf(walletAddress);

  console.log(`WBTC Balance: ${hre.ethers.utils.formatUnits(wbtcBalance, 8)}`);
  console.log(`WETH Balance: ${hre.ethers.utils.formatUnits(wethBalance, 18)}`);
}

// Function to perform swap on Uniswap
async function swapOnUniswap(amountIn, amountOutMin, path, wallet) {
  const tx = await uRouter.swapExactTokensForTokens(
    amountIn,
    amountOutMin,
    path,
    wallet.address,
    Math.floor(Date.now() / 1000) + 60 * 20 // 20 minutes deadline
  );
  await tx.wait();
  console.log('Swap completed on Uniswap');
}

// Function to perform swap on Sushiswap
async function swapOnSushiswap(amountIn, amountOutMin, path, wallet) {
  const tx = await sRouter.swapExactTokensForTokens(
    amountIn,
    amountOutMin,
    path,
    wallet.address,
    Math.floor(Date.now() / 1000) + 60 * 20 // 20 minutes deadline
  );
  await tx.wait();
  console.log('Swap completed on Sushiswap');
}

// Export the initialized contracts and provider
module.exports = {
  provider,
  uFactory,
  uRouter,
  sFactory,
  sRouter,
  WBTC,
  WETH,
  arbitrage,
  checkBalances,
  swapOnUniswap,
  swapOnSushiswap
};
