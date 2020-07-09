const bodyParser = require('body-parser');
const express = require('express');
const fs = require('fs');
const Web3 = require('web3');

const adapterKey = fs.readFileSync(".adapterKey").toString().trim();
const app = express();
const port = process.env.ADAPTER_PORT || 30056;

let web3 = new Web3();
// The auth object holds the adapter auth credentials for communicating with Chainlink
let auth = {'incomingToken': ''};

// Setup different configurations if the project is running from inside a Docker container. If not, use defaults
const RSK_NODE = {
	protocol: process.env.RSK_WS_PROTOCOL || 'ws',
	host: process.env.RSK_HOST || 'localhost',
	port: process.env.RSK_WS_PORT || 4445,
	url: process.env.RSK_WS_URL || '/websocket'
};
const RSK_CONFIG = {
	'name': 'RSK',
	'shortname': 'regtest',
	'url': `${RSK_NODE.protocol}://${RSK_NODE.host}:${RSK_NODE.port}${RSK_NODE.url}`
};

app.use(bodyParser.json());

// Simple logger middleware that prints the requests received on the adapter endpoints
app.use(function (req, res, next) {
	console.log('[INFO] - Received ' + req.method + ' request on ' + req.baseUrl + req.originalUrl + ' URL');
	next();
});

// Healthcheck endpoint
app.get("/", (req, res) => {
	return res.sendStatus(200);
});

// The main endpoint that receives Chainlink requests
app.post("/adapter", async (req, res) => {
	// TODO: Validate Chainlink auth token

	// Checks if it is a valid request
	if ((typeof req.body.id !== 'undefined') && (typeof req.body.data !== 'undefined')){
		console.log(`[INFO] - Adapter received fulfillment request for run id ${req.body.id}`);
		try {
			// Try to fulfill the request and send the TX hash to Chainlink
			const tx = await fulfillRequest(req.body.data);
			var rJson = JSON.stringify({
				"jobRunID": req.body.id,
				"data": {
					"status": "completed",
					"result": tx
				},
				"error": null
			});
			return res.send(rJson);
		}catch(e){
			// On error, print it and report to Chainlink
			console.error(e);
			var rJson = JSON.stringify({
				"jobRunID": req.body.id,
				"error": "Error trying to fulfill request"
			});
			return res.send(rJson);
		}
	}else{
		return res.sendStatus(400);
	}
});

/* Configures the adapter with a web3 instance connected to a RSK network and sets up the adapter's wallet */
async function adapterSetup(){
	try {
		// Configures the web3 instance connected to RSK network
		web3 = await setupNetwork(RSK_CONFIG);
		const chainId = await web3.eth.net.getId();
		console.log(`[INFO] - Web3 is connected to the ${RSK_CONFIG.name} node. Chain ID: ${chainId}`);

		// Import the adapter private key to web3 wallets and make it the default account
		web3.eth.accounts.wallet.add({privateKey: '0x' + adapterKey});
		web3.defaultAccount = web3.eth.accounts.wallet[0].address;
	}catch(e){
		console.error('[ERROR] - Adapter setup failed:' + e);
	}
}

/* Fulfills a Chainlink request sending the given data to the specified address.
   functionSelector and dataPrefix params are optional, but if the request comes
   from the RSK Initiator, they are surely present */
async function fulfillRequest(req){
	return new Promise(async function(resolve, reject){
		try {
			let functionSelector = '', dataPrefix = '', encodedFulfill = '0x';
			if (typeof req.functionSelector !== 'undefined'){
				functionSelector = req.functionSelector.slice(2);
			}
			if (typeof req.dataPrefix !== 'undefined'){
				dataPrefix = req.dataPrefix.slice(2);
			}

			// Concatenate the data
			encodedFulfill += functionSelector + dataPrefix + req.result.slice(2);

			// TX params
			const tx = {
				gas: 500000,
				to: req.address,
				data: encodedFulfill
			};

			// Sign the transaction with the adapter's private key
			const signed = await web3.eth.accounts.signTransaction(tx, adapterKey);

			// Send the signed transaction and resolve the TX hash, only if the transaction
			// succeeded and events were emitted. If not, reject with tx receipt
			web3.eth.sendSignedTransaction(signed.rawTransaction).then(receipt => {
				console.log('[INFO] - Fulfill Request TX has been mined: ' + receipt.transactionHash);
				if ((typeof receipt.status !== 'undefined' && receipt.status == true) && (typeof receipt.logs !== 'undefined' && receipt.logs.length > 0)){
					resolve(receipt.transactionHash);
				}else{
					reject(receipt);
				}
			}).catch(error => {
				console.error(error);
				reject(error);
			});
		}catch(e){
			reject(e);
		}
	});
}

/* Reads a json file and returns the parsed object */
function loadJson(file){
	return new Promise(function (resolve, reject){
		fs.readFile(file, 'utf8', (err, data) => {
			if (!err){
				const jsonData = JSON.parse(data);
				resolve(jsonData);
			}else{
				resolve({'error': err.toString()});
			}
		});
	});
}

/* Creates a new web3 instance connected to the specified network */
function setupNetwork(node){
	return new Promise(async function(resolve, reject){
		console.log(`[INFO] - Waiting for ${node.name} node to be ready, connecting to ${node.url}`);
		// Wrap the process in a function to be able to call it again if can't connect
		(function tryConnect() {
			const wsProvider = new Web3.providers.WebsocketProvider(node.url);
			web3.setProvider(wsProvider);
			// Check connection with isListening()
			web3.eth.net.isListening().then(() => {
				resolve(web3);
			}).catch(e => {
				// If error, print it and try to connect again after 10 seconds
				console.error(`[ERROR] - Could not connect to ${node.name} node, retrying in 10 seconds...`)
				console.error(e);
				setTimeout(tryConnect, 10000);
			});
		})();
	}).catch(e => {
		reject(e);
	});
}

const server = app.listen(port, function() {
	console.log(`[INFO] - RSK TX Adapter listening on port ${port}!`);
	adapterSetup();
});
