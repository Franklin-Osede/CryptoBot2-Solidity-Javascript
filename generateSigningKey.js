// Import the ethers library
const { ethers } = require('ethers');

// Function to generate a new Ethereum wallet
const generateWallet = () => {
  const wallet = ethers.Wallet.createRandom();
  console.log("Address: " + wallet.address);
  console.log("Private Key: " + wallet.privateKey);
};

// Generate and display the wallet
generateWallet();
