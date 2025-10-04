// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract ProofRegistry {
    event ProofSubmitted(bytes32 indexed merkleRoot, string ipfsCid, address indexed sender, uint256 timestamp);

    struct Proof {
        string ipfsCid;
        uint256 timestamp;
        address submitter;
    }

    mapping(bytes32 => Proof) public proofs;

    function submitProof(bytes32 merkleRoot, string calldata ipfsCid) external {
        require(proofs[merkleRoot].timestamp == 0, "Merkle root already exists");

        proofs[merkleRoot] = Proof({
            ipfsCid: ipfsCid,
            timestamp: block.timestamp,
            submitter: msg.sender
        });

        emit ProofSubmitted(merkleRoot, ipfsCid, msg.sender, block.timestamp);
    }

    function verifyProof(bytes32 merkleRoot) external view returns (Proof memory) {
        return proofs[merkleRoot];
    }
}
