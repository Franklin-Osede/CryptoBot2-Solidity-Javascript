const hre = require("hardhat")
require("dotenv").config()

// Import the ABIs for Uniswap V2 Router and Factory
const IUniswapV2Router02 = require('@uniswap/v2-periphery/build/IUniswapV2Router02.json')
const IUniswapV2Factory = require("@uniswap/v2-core/build/IUniswapV2Factory.json")

let provider;

// Check if we are using a local or remote provider
if (config.PROJECT_SETTINGS.isLocal) {
  provider = new hre.ethers.providers.JsonRpcProvider(`http://127.0.0.1:8545/`)
} else {
  provider = new hre.ethers.providers.JsonRpcProvider(`https://polygon-mainnet.infura.io/v3/${process.env.INFURA_API_KEY}`)
}

// Initialize Uniswap contracts
const uFactory = new hre.ethers.Contract(config.UNISWAP.FACTORY_ADDRESS, IUniswapV2Factory.abi, provider)
const uRouter = new hre.ethers.Contract(config.UNISWAP.V2_ROUTER_02_ADDRESS, IUniswapV2Router02.abi, provider)

// Initialize Sushiswap contracts
const sFactory = new hre.ethers.Contract(config.SUSHISWAP.FACTORY_ADDRESS, IUniswapV2Factory.abi, provider)
const sRouter = new hre.ethers.Contract(config.SUSHISWAP.V2_ROUTER_02_ADDRESS, IUniswapV2Router02.abi, provider)

// Initialize Quickswap contracts
const qFactory = new hre.ethers.Contract(config.QUICKSWAP.FACTORY_ADDRESS, IUniswapV2Factory.abi, provider)
const qRouter = new hre.ethers.Contract(config.QUICKSWAP.V2_ROUTER_02_ADDRESS, IUniswapV2Router02.abi, provider)

// Initialize Apeswap contracts
const aFactory = new hre.ethers.Contract(config.APESWAP.FACTORY_ADDRESS, IUniswapV2Factory.abi, provider)
const aRouter = new hre.ethers.Contract(config.APESWAP.V2_ROUTER_02_ADDRESS, IUniswapV2Router02.abi, provider)

// Arbitrage contract initialization
const IArbitrage = require('../artifacts/contracts/Arbitrage.sol/Arbitrage.json')
const arbitrage = new hre.ethers.Contract(config.PROJECT_SETTINGS.ARBITRAGE_ADDRESS, IArbitrage.abi, provider)

// Export the initialized contracts and provider
module.exports = {
  provider,
  uFactory,
  uRouter,
  sFactory,
  sRouter,
  qFactory,
  qRouter,
  aFactory,
  aRouter,
  arbitrage
}
