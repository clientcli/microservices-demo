import fs from "fs";
import { ethers } from "hardhat";

async function main() {
  const ProofRegistry = await ethers.getContractFactory("ProofRegistry");
  const registry = await ProofRegistry.deploy();
  await registry.deployed();

  console.log("✅ ProofRegistry deployed to:", registry.address);

  fs.writeFileSync("deployed_address.txt", registry.address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
