const hre = require("hardhat");
const config = require("../config.json");

async function main() {
  try {
    // Fetch the contract factory for the Arbitrage contract
    console.log("Fetching contract factory...");
    const Arbitrage = await hre.ethers.getContractFactory("Arbitrage");
    
    // Deploy the contract with the required addresses
    console.log("Deploying the Arbitrage contract...");
    const arbitrage = await Arbitrage.deploy(
      config.SUSHISWAP.V2_ROUTER_02_ADDRESS,
      config.UNISWAP.V2_ROUTER_02_ADDRESS,
      config.QUICKSWAP.V2_ROUTER_02_ADDRESS,
      config.APESWAP.V2_ROUTER_02_ADDRESS,
      config.QUICKSWAP.V2_FACTORY_ADDRESS,
      config.APESWAP.V2_FACTORY_ADDRESS
    );

    // Wait for the deployment to be mined
    console.log("Waiting for the deployment to be mined...");
    await arbitrage.deployed();

    // Log the address of the deployed contract
    console.log(`Arbitrage contract deployed to: ${arbitrage.address}`);
  } catch (error) {
    // Log any errors that occur during the deployment
    console.error("Error during contract deployment:", error);
    // Set the process exit code to 1 to indicate failure
    process.exitCode = 1;
  }
}

// Execute the main function and handle any uncaught errors
main().catch((error) => {
  console.error("Uncaught error in main function:", error);
  process.exitCode = 1;
});
