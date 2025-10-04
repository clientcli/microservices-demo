pragma circom 2.0.0;


include "circomlib/circuits/sha256/sha256.circom";


template Main() {
    signal input in[256]; // private input bytes
    signal output digest[256]; // SHA256 output as bits


    // SHA256 component
    component hasher = Sha256(256);


    // Connect input bits
    for (var i = 0; i < 256; i++) {
    hasher.in[i] <== in[i];
    }


    // Assign all 256 output bits
    for (var i = 0; i < 256; i++) {
    digest[i] <== hasher.out[i];
    }
}


component main = Main();