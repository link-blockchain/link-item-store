var Web3 = require('web3');

// @see https://gist.github.com/frozeman/fbc7465d0b0e6c1c4c23
if (typeof web3 !== 'undefined') {
  var defaultAccount = web3.eth.defaultAccount;
  var web3 = new Web3(web3.currentProvider);
  web3.eth.defaultAccount = defaultAccount;
}
else {
  var web3 = new Web3(new Web3.providers.HttpProvider("http://localhost:8545"));
  web3.eth.defaultAccount = web3.eth.accounts[0];
}

var blobstoreAbi = require('./blobstore.abi.json');
var blobstoreContract = web3.eth.contract(blobstoreAbi);
var blobstoreAddress = '0x8f3fae469b08e48d8e2a692e0b9805c38509231b';
var blobstore = blobstoreContract.at(blobstoreAddress);

// solc version: 0.2.0-0/Release-Linux/g++/int linked to libethereum-1.1.0-0/Release-Linux/g++/int

var getBlobHash = function(blob) {
  return '0x' + web3.sha3(blob.toString('hex'), {encoding: 'hex'});
}

var getBlobBlock = function(hash, block) {
  // Determine the block that includes the transaction for this blob.
  return blobstore.getBlobBlock(hash, {}, block).toNumber();
}

var storeBlob = function(blob) {
  // Determine hash of blob.
  var hash = getBlobHash(blob);
  // Check if this blob already exists 200 blocks back.
  if (getBlobBlock(hash, web3.eth.blockNumber - 200) == 0) {
    // Calculate maximum transaction gas.
    var gas = 44800 + 78 * blob.length;
    // Broadcast the transaction. If this blob is already in a transaction this
    // will be handled by the contract.
    blobstore.storeBlob('0x' + blob.toString('hex'), {gas: gas});
    // Check that the blob is pending.
    if (getBlobBlock(hash, 'pending') == 0) {
      throw "Failed to publish blob.";
    }
  }
  return hash;
}

var getBlob = function(hash, callback) {
  var blobBlock = getBlobBlock(hash, 'latest');
  if (blobBlock == 0) {
    // The blob isn't in a block yet. See if it is in a pending transaction.
    // This will only work if the blob was stored directly by a transaction.
    var txids = web3.eth.getBlock('pending').transactions;
    for (var i in txids) {
      var tx = web3.eth.getTransaction(txids[i]);
      if (tx.to != blobstoreAddress) {
        continue;
      }
      // Extract the blob from the transaction.
      var length = parseInt(tx.input.substr(74, 64), 16);
      var blob = new Buffer(tx.input.substr(138, length * 2), 'hex');
      // Does it have the correct hash?
      if (getBlobHash(blob) == hash) {
        callback(null, blob);
        return;
      }
    }
    // We didn't find the blob. Check in the blocks one more time in case it
    // just got mined and we missed it.
    blobBlock = getBlobBlock(hash, 'latest');
    if (blobBlock == 0) {
      // We didn't find it. Report the Error.
      callback('error');
      return;
    }
  }
  // If the blob is in a block that occured within the past hour, search from an
  // hour ago until the latest block in case there has been a re-arragement
  // since we got the block number (very conservative).
  var fromBlock, toBlock;
  if (blobBlock > web3.eth.blockNumber - 200) {
    fromBlock = web3.eth.blockNumber - 200;
    toBlock = 'latest';
  }
  else {
    fromBlock = toBlock = blobBlock;
  }
  var filter = web3.eth.filter({fromBlock: fromBlock, toBlock: toBlock, address: blobstoreAddress, topics: [hash]});
  filter.get(function(error, result) {
    if (result.length != 0) {
      var length = parseInt(result[0].data.substr(66, 64), 16);
      callback(null, new Buffer(result[0].data.substr(130, length * 2), 'hex'));
    }
    else {
      // There has just been a re-arrangement and the trasaction is now back to
      // pending. Let's try again from the start.
      getBlob(hash, callback);
    }
  });
}

module.exports = {
  getBlobHash: getBlobHash,
  getBlobBlock: getBlobBlock,
  storeBlob: storeBlob,
  getBlob: getBlob
};
