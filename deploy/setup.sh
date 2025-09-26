#!/bin/bash
# Compile the circuits
cd ../src/poe-sidecar/circuits
mkdir -p ../circuit-artifacts
circom poe.circom --wasm --r1cs -o ../circuit-artifacts -l ~/dev

cd ../circuit-artifacts
# Generate a small ptau for testing
snarkjs powersoftau new bn128 18 pot18_0000.ptau -v
snarkjs powersoftau contribute pot18_0000.ptau pot18_0001.ptau --name="First contribution" -v
snarkjs powersoftau prepare phase2 pot18_0001.ptau powersOfTau28_hez_final_10.ptau -v
snarkjs powersoftau verify powersOfTau28_hez_final_10.ptau

#Plonk setup
snarkjs plonk setup poe-circom poe-final.zkey poe-proof.json
# snarkjs plonk export solidityverifier poe-final.zkey verifier.sol

# Build the Docker image
# cd ../../../deploy/docker-compose/
# docker-compose -f docker-compose.poe.yml build

# Run the Docker compose file
# docker-compose -f docker-compose.poe.yml up