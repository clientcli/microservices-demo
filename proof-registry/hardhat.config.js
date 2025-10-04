// Use import instead of require
import "@nomicfoundation/hardhat-toolbox";

// Export configuration using ESM syntax
export default {
  solidity: "0.8.20",
  defaultNetwork: "localhost",
  networks: {
    localhost: {
      url: "http://127.0.0.1:8545"
    }
  }
};
