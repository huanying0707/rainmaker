# byteball-testnet-bulider
Generate byteball genesis unit  and run your byteball testnet (alpha version) ，the project inspired by https://github.com/eaglo/byteball-genesis and https://github.com/pmiklos/byteball-devnet 

## setup witeness and hub
setup 3（or more）witeness host & 1 hub，and edit witness and hub's `node_modules/byteballcore/constants.js`
```
exports.COUNT_WITNESSES = 3;  // the number your witnesses
exports.version = '1.0test';
exports.alt = '3';

exports.GENESIS_UNIT ="";

```

## get  witness_info 
run a script on every witeness host to collect the witness_info,  append the witness_info to a json array file

the script to get witness_info named `readwitenessinfo.js`
```
"use strict";
const fs = require('fs');
const util = require('util');
const db = require('byteballcore/db.js');
const conf = require('byteballcore/conf.js');
const desktopApp = require('byteballcore/desktop_app.js');
var readline = require('readline');


var appDataDir = desktopApp.getAppDataDir();
var KEYS_FILENAME = appDataDir + '/' + (conf.KEYS_FILENAME || 'keys.json');



var item = {};


  var readmem = function readKeys(){
    console.log("\n Read mnemonic...........\n");

  	fs.readFile(KEYS_FILENAME, 'utf8', function(err, data){
  		var rl = readline.createInterface({
  			input: process.stdin,
  			output: process.stdout,
  			//terminal: true
  		});

  		if (err){ 
  			console.log('failed to read keys.conf, you should generate a headless-wallet first!');
  			throw Error('failed to read key.conf: '+err);
  		}
  		else{ 
  			rl.question("Passphrase: ", function(passphrase){
  				rl.close();
  				if (process.stdout.moveCursor) process.stdout.moveCursor(0, -1);
  				if (process.stdout.clearLine)  process.stdout.clearLine();
  				var keys = JSON.parse(data);
  				item.passphrase = passphrase; // add passphrase attrbuite
  				item.mnemonic_phrase = keys.mnemonic_phrase;
  				item.temp_priv_key = keys.temp_priv_key;
  				item.prev_temp_priv_key = keys.prev_temp_priv_key;
  				readkeys();
  			});
  		}
  	});
  };



  // READ definition first!!!
  var readkeys = function(){
    db.query("SELECT * FROM my_addresses", function(rows){

         console.log("\n Read definition...........\n");
         if (rows.length < 1 ) {
           console.log('my_addresses has no entry, you should creat a headless-wallet first!!! ');
     			 process.exit(0);
         }
          // console.log(JSON.stringify(rows[0], null,2));
          var row = rows[0];
          item.address = row.address;
          item.wallet = row.wallet;
          item.is_change = row.is_change;
          item.address_index = row.address_index;
          item.definition = JSON.parse(row.definition);
          item.creation_date = row.creation_date;
          console.log("\nShow Local wallet info........... >>\n\n"
          + JSON.stringify(item, null, 2));
          process.exit(0);
    });
  };

readmem();

```

### and Generate a configdata file

run  `node readwitenessinfo.js`  on every witness, and get the output json objects, and put them into a configdata file called `"bgenesis.json"` 

## run GENESIS_UNIT generate script 
run GENESIS_UNIT generate script called `"bgenesis.js"`, and get the GENESIS_UNIT address, set GENESIS_UNIT properly on erver witness and hub. and run hub and witness

```
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
const creation_message = "heal the world!";

var genesisConfigData = {};
var witnesses = [
  "FS6UYR55WTEMD4SE3UA3N6YM2KW7WVBZ",
  "JNWLJX4NLOWNIAJYWEB5MFCR4MEP3ECQ",
  "VZTB3A7GXXLETF7TOJ4NOSGVDL2U5JG3"
];

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
    console.log("\n\n----On error: Genesis---\n\n");
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
    console.log(">> about to  signature with private key: " + xPrivKey);

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
        console.log(" \n\n conf_entry is ---> \n" + JSON.stringify(conf_entry,null,2));
        // definition = JSON.parse(conf_entry["definition"]);
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
    console.log("\n\n------Step1 enter Genesis-------\n\n");

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
                console.log("\n\n-------STEP2 composseJoint ifOk: Genesis is ------>> "+ objJoint.unit.unit);
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


```

### test and improve

the script not be tested sufficient， so if you find some bugs ， any notice are wellcome！！！

contact me ： `max@outman.com`
 
