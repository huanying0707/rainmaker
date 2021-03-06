"use strict";
const fs = require('fs');
const db = require('byteballcore/db.js');
const headlessWallet = require('headless-byteball');
const eventBus = require('byteballcore/event_bus.js');
const constants = require('byteballcore/constants.js');
var objectHash = require('byteballcore/object_hash.js');
var Mnemonic = require('bitcore-mnemonic');
var ecdsaSig = require('byteballcore/signature.js');
var validation = require('byteballcore/validation.js');


const witness_budget = 1000000;
const witness_budget_count = 10;
const genesisConfigFile = "./bgenesis.json";
const creation_message = "heal the world!"

var genesisConfigData = {};

//  the witnesses address should be added in witeness array
//  Pay attention: the  witeness[] should be ordered by alphabet ！！！
var witnesses = [
  "FS6UYR55WTEMD4SE3UA3N6YM2KW7WVBZ",
  "JNWLJX4NLOWNIAJYWEB5MFCR4MEP3ECQ",
  "VZTB3A7GXXLETF7TOJ4NOSGVDL2U5JG3"
].sort();

var arrOutputs = [
    {address: witnesses[0], amount: 0 }    //first set the change output address to witnesses[0]
];

for (let witness of witnesses) {           // initial the payment arrOutputs
    for(var i=0; i<witness_budget_count; ++i) {
        arrOutputs.push({address: witness, amount: witness_budget});
    }
}


function  rungen(){
  fs.readFile(genesisConfigFile, 'utf8', function(err, data) {
      if (err){
        console.log("Read genesis input file \"bgenesis.json\" failed: " + err);
        process.exit(0);
      }
      // set global data
      genesisConfigData = JSON.parse(data);
      console.log("Read genesis input data\n: %s", JSON.stringify(genesisConfigData,null,2) );

      createGenesisUnit(witnesses, function(genesisHash) {
          console.log("\n\n---------->>->> Genesis d, hash=" + genesisHash+ "\n\n");
          process.exit(0);
      });
  });
}

function onError(err) {
    throw Error(err);
}


function getConfEntryByAddress(address) {

    for (let item of genesisConfigData) {
        if(item["address"] === address){
            return item;
        }
    }
    console.log(" \n >> Error: witness address "
    + address +" not founded in the \"bgensis.json\" file!!!!\n");
    process.exit(0);
    //return null;
}

function getDerivedKey(mnemonic_phrase, passphrase, account, is_change, address_index) {
    var mnemonic = new Mnemonic(mnemonic_phrase);
    var xPrivKey = mnemonic.toHDPrivateKey(passphrase);
    //console.log(">> about to  signature with private key: " + xPrivKey);
    var path = "m/44'/0'/" + account + "'/"+is_change+"/"+address_index;
    var derivedPrivateKey = xPrivKey.derive(path).privateKey;
    console.log(">> derived key: " + derivedPrivateKey);

    return derivedPrivateKey.bn.toBuffer({size:32});        // return as buffer
}

// signer that uses witeness address
var signer = {
    readSigningPaths: function(conn, address, handleLengthsBySigningPaths){
        handleLengthsBySigningPaths({r: constants.SIG_LENGTH});
    },
    readDefinition: function(conn, address, handleDefinition){
        var conf_entry = getConfEntryByAddress(address);
       // console.log(" \n\n conf_entry is ---> \n" + JSON.stringify(conf_entry,null,2));
        var definition = conf_entry["definition"];
        handleDefinition(null, definition);
    },
    sign: function(objUnsignedUnit, assocPrivatePayloads, address, signing_path, handleSignature){
        var buf_to_sign = objectHash.getUnitHashToSign(objUnsignedUnit);
        var item = getConfEntryByAddress(address);
        var derivedPrivateKey = getDerivedKey(
            item["mnemonic_phrase"],
            item["passphrase"],
            0,
            item["is_change"],
            item["address_index"]
          );
        handleSignature(null, ecdsaSig.sign(buf_to_sign, derivedPrivateKey));
    }
};



function createGenesisUnit(witnesses, onDone) {
    var composer = require('byteballcore/composer.js');
    var network = require('byteballcore/network.js');

    var savingCallbacks = composer.getSavingCallbacks({
        ifNotEnoughFunds: onError,
        ifError: onError,
        ifOk: function(objJoint) {
            network.broadcastJoint(objJoint);
            onDone(objJoint.unit.unit);
        }
    });

    composer.setGenesis(true);

    var genesisUnitInput = {
        witnesses: witnesses,
        paying_addresses: witnesses,
        outputs: arrOutputs,
        signer: signer,
        callbacks: {
            ifNotEnoughFunds: onError,
            ifError: onError,
            ifOk: function(objJoint, assocPrivatePayloads, composer_unlock) {
                constants.GENESIS_UNIT = objJoint.unit.unit;
                savingCallbacks.ifOk(objJoint, assocPrivatePayloads, composer_unlock);
            }
        },
        messages: [{
            app: "text",
            payload_location: "inline",
            payload_hash: objectHash.getBase64Hash(creation_message),
            payload: creation_message
        }]
    };

    composer.composeJoint( genesisUnitInput );

}

eventBus.once('headless_wallet_ready', function() {

    rungen();

});
