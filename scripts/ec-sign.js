// ECDSA/SHA-256 (P-256) signing helper used by sign-package.py.
// Usage: node ec-sign.js <private-key.pem> <data-file> <signature-out>
"use strict";

var fs = require("fs");
var crypto = require("crypto");

var keyPath = process.argv[2];
var dataPath = process.argv[3];
var outPath = process.argv[4];
if (!keyPath || !dataPath || !outPath) {
  console.error("usage: node ec-sign.js <private-key.pem> <data-file> <signature-out>");
  process.exit(2);
}

var key = fs.readFileSync(keyPath);
var data = fs.readFileSync(dataPath);
var signature = crypto.sign("sha256", data, { key: key, dsaEncoding: "der" });
fs.writeFileSync(outPath, signature.toString("base64"));
