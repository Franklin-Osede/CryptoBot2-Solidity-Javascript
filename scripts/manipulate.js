// Load required libraries and configurations
require("dotenv").config();
const ethers = require("ethers");
const hre = require("hardhat");

// Import helper functions for token and contract interactions and DEX initialization data
const { getTokenAndContract, getPairContract, calculatePrice } = require('../helpers/helpers');
const { provider, uFactory, uRouter, sFactory, sRouter, qFactory, qRouter, aFactory, aRouter } = require('../helpers/initialization');

// Define constants using environment variables for better security and flexibility
const WETH_ADDRESS = process.env.WETH_ADDRESS;  // Ethereum address for WETH token
const WMATIC_ADDRESS = process.env.WMATIC_ADDRESS;  // Ethereum address for WMATIC token
const UNLOCKED_ACCOUNT = process.env.UNLOCKED_ACCOUNT;  // Example account for testing

// Specify a very large amount for testing, equivalent to 1 billion WETH, to simulate high-volume transactions
const UNREALISTIC_AMOUNT_WETH = ethers.utils.parseUnits("1000000000", "ether");  // 1 billion WETH expressed in wei

// Main asynchronous function to perform testing
async function main() {
    const provider = new ethers.providers.JsonRpcProvider(process.env.RPC_URL);  // Connect to Ethereum network using provider URL from .env

    // Fetch token contract instances for WETH and WMATIC tokens
    const {
        token0Contract: wethContract,
        token1Contract: wmaticContract
    } = await getTokenAndContract(WETH_ADDRESS, WMATIC_ADDRESS, provider);

    // Define DEX configurations for multiple DEX interactions
    const exchanges = {
        uniswap: { factory: uFactory, router: uRouter },
        sushiswap: { factory: sFactory, router: sRouter },
        quickswap: { factory: qFactory, router: qRouter },
        apeswap: { factory: aFactory, router: aRouter }
    };

    // Iterate through each configured DEX to test price manipulations
    for (const [name, dex] of Object.entries(exchanges)) {
        console.log(`Processing ${name}...`);
        const pair = await getPairContract(dex.factory, WETH_ADDRESS, WMATIC_ADDRESS, provider);  // Get the pair contract for WETH and WMATIC

        // Calculate the price before manipulation to establish a baseline
        const priceBefore = await calculatePrice(pair);

        // Perform price manipulation using an unrealistic amount of WETH
        await manipulatePrice(dex.router, [WETH_ADDRESS, WMATIC_ADDRESS], wethContract, UNREALISTIC_AMOUNT_WETH);

        // Calculate the price after manipulation to assess the impact
        const priceAfter = await calculatePrice(pair);

        // Output the results to console for comparison
        console.log(`${name} Price Before: 1 WETH = ${ethers.utils.formatUnits(priceBefore, 'ether')} WMATIC`);
        console.log(`${name} Price After: 1 WETH = ${ethers.utils.formatUnits(priceAfter, 'ether')} WMATIC`);
    }
}

// Function to manipulate prices on a given DEX router
async function manipulatePrice(routerAddress, path, tokenContract, amount) {
    // Impersonate an unlocked account to bypass typical security requirements for testing
    await hre.network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [UNLOCKED_ACCOUNT]
    });

    const signer = await hre.ethers.getSigner(UNLOCKED_ACCOUNT);  // Get the signer for transactions

    // Approve the router to handle a specified amount of WETH tokens
    const approval = await tokenContract.connect(signer).approve(routerAddress, amount);
    await approval.wait();

    // Create a router instance and execute a swap transaction
    const router = new ethers.Contract(routerAddress, ['function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] path, address to, uint deadline)'], signer);
    const deadline = Math.floor(Date.now() / 1000) + 60 * 20;  // Set a transaction deadline 20 minutes into the future

    // Perform the token swap and wait for the transaction to complete
    const swap = await router.swapExactTokensForTokens(amount, 0, path, signer.address, deadline);
    await swap.wait();

    console.log("Swap executed successfully on " + routerAddress);
}

// Catch and log any errors that occur during the execution of the main function
main().catch((error) => {
    console.error("Failed to execute arbitrage strategy:", error);
    process.exit(1);
});
