import { ethers } from "hardhat";

async function main() {
  const [signer] = await ethers.getSigners();

  if (!process.env.CHAIN_CONTRACT_ADDRESS) {
    throw new Error("Please set CHAIN_CONTRACT_ADDRESS env variable");
  }

  const registry = await ethers.getContractAt(
    "ProofRegistry",
    process.env.CHAIN_CONTRACT_ADDRESS,
    signer
  );

  const tx = await registry.submitProof(
    ethers.utils.keccak256(ethers.utils.toUtf8Bytes("workflow1")),
    "QmExampleIpfsCID"
  );

  const receipt = await tx.wait();
  console.log("✅ Gas used:", receipt.gasUsed.toString());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
