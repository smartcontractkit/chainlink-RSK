const bodyParser = require('body-parser');
const ChainlinkAPIClient = require('chainlink-api-client');
const { exec } = require('child_process');
const express = require('express');
const db = require('./db.js');
const fs = require('fs');
const rskUtils = require('rskjs-util');
const Web3 = require('web3');
require('console-stamp')(console);

const adapterKey = fs.readFileSync(".adapterKey").toString().trim();
const app = express();
const port = process.env.ADAPTER_PORT || 30056;

let web3 = new Web3();
// Handle the TX count through the currentNonce variable
let currentNonce;

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

// Initialize the Chainlink API Client without credentials, the adapter will login using the token
let chainlink = new ChainlinkAPIClient({
	basePath: process.env.CHAINLINK_BASE_URL
});

app.use(bodyParser.json());

// Simple logger middleware that prints the requests received on the adapter endpoints
app.use(function (req, res, next) {
	console.info('Received ' + req.method + ' request on ' + req.baseUrl + req.originalUrl + ' URL');
	next();
});

// Healthcheck endpoint
app.get("/", (req, res) => {
	return res.sendStatus(200);
});

// The main endpoint that receives Chainlink requests
app.post("/adapter", async (req, res) => {
	// Checks if it is a valid request
	if ((typeof req.body.id !== 'undefined') && (typeof req.body.data !== 'undefined')){
		try {
			if (typeof req.headers['authorization'] !== 'undefined'){
				const outgoingToken = req.headers['authorization'].slice(7);
				const authenticated = await chainlinkAuth(outgoingToken);
				if (!authenticated){
					return res.sendStatus(401);
				}else{
					const runId = req.body.id;
					console.info(`Adapter received fulfillment request for run id ${runId}`);
					// Process the request while sending pending status to Chainlink
					processRequest(runId, req.body.data);
					var rJson = JSON.stringify({
						"jobRunID": runId,
						"data": {},
						"status": "pending",
						"pending": true,
						"error": null
					});
					return res.send(rJson);
				}
			}else{
				return res.sendStatus(401);
			}
		}catch(e){
			// On error, print it and report to Chainlink
			console.error(e);
			var rJson = JSON.stringify({
				"jobRunID": runId,
				"data": {},
				"status": "errored",
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
		console.info(`Web3 is connected to the ${RSK_CONFIG.name} node. Chain ID: ${chainId}`);

		// Import the adapter private key to web3 wallets and make it the default account
		web3.eth.accounts.wallet.add({privateKey: '0x' + adapterKey});
		web3.defaultAccount = web3.eth.accounts.wallet[0].address;
		// Initialize currentNonce variable with current account's TX count
		currentNonce = await web3.eth.getTransactionCount(web3.defaultAccount, 'pending');
		console.info(`Adapter account address RSK Checksum: ${rskUtils.toChecksumAddress(web3.defaultAccount, chainId)}`);
		console.info(`Adapter account address ETH Checksum: ${web3.utils.toChecksumAddress(web3.defaultAccount)}`);
	}catch(e){
		console.error('Adapter setup failed:' + e);
	}
}

/* Validates Chainlink auth credentials */
async function chainlinkAuth(outgoingToken){
	return new Promise(async function (resolve, reject){
		const result = await db.query('SELECT outgoing_token_hash FROM auth_data');
		if (result.rows.length > 0){
			const outgoingTokenHash = web3.utils.sha3(outgoingToken).slice(2);
			if (outgoingTokenHash == result.rows[0].outgoing_token_hash){
				resolve(true);
			}else{
				resolve(false);
			}
		}else{
			reject('Failed auth: no auth data present');
		}
	});
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
			const gasPrice = parseInt(await web3.eth.getGasPrice() * 1.3);
			// TX params
			const tx = {
				gas: 500000,
				gasPrice: gasPrice,
				nonce: currentNonce,
				to: req.address,
				data: encodedFulfill
			};
			// Increment nonce for the next TX
			currentNonce++;
			// Sign the transaction with the adapter's private key
			const signed = await web3.eth.accounts.signTransaction(tx, adapterKey);
			// Send the signed transaction and resolve the TX hash, only if the transaction
			// succeeded and events were emitted. If not, reject with tx receipt
			web3.eth.sendSignedTransaction(signed.rawTransaction)
			.on('receipt', function(receipt){
				console.info('Fulfill Request TX has been mined: ' + receipt.transactionHash);
				if ((typeof receipt.status !== 'undefined' && receipt.status == true) && (typeof receipt.logs !== 'undefined' && receipt.logs.length > 0)){
					// TODO: Save transaction history to database
					resolve(receipt.transactionHash);
				}else{
					reject(receipt);
				}
			}).on('transactionHash', async function(hash){
				console.info(`Transaction ${hash} is in TX Pool`);
			}).on('error', async function(e){
				// If the nonce counter is wrong, correct it and try again
				if (e.toString().indexOf('nonce too high') > -1 || e.toString().indexOf('Transaction was not mined within') > -1 || e.toString().indexOf('nonce too low') > -1 ){
					console.info('There was a nonce mismatch, will correct it and try again...');
					currentNonce = await web3.eth.getTransactionCount(web3.defaultAccount, 'pending');
					fulfillRequest(req).then(tx => {
						resolve(tx);
					}).catch(e => {
						reject(e);
					});
				}else{
					reject(e);
				}
			});
		}catch(e){
			reject(e);
		}
	});
}

/* Reads the database and returns the Chainlink Node auth data */
function loadCredentials(){
	return new Promise(async function (resolve, reject){
		const result = await db.query('SELECT * FROM auth_data');
		if (result.rows.length > 0){
			const auth = {
				incomingToken: result.rows[0].incoming_token
			};
			resolve(auth);
		}else{
			reject('No auth data present');
		}
	});
}

/* Tries to fulfill a request and sends the TX hash to Chainlink */
async function processRequest(runId, reqData){
	const auth = await loadCredentials();
	fulfillRequest(reqData).then(async function(tx){
		const data = {
			"id": runId,
			"data": {
				"result": tx
			},
			"status": "completed",
			"pending": false
		}
		// Update the job run, passing auth credentials and data object
		const updateRun = await chainlink.updateJobRun(auth.incomingToken, data);
		if (!updateRun.errors){
			console.info(`Updated job run with ID ${updateRun.data.attributes.id} status: COMPLETED`);
		}else{
			throw updateRun.errors;
		}
	}).catch(async e => {
		console.error(e);
		const data = {
			"id": runId,
			"data": {},
			"status": "errored",
			"error": "Error trying to fulfill request"
		}
		// Update the job run, passing auth credentials and data object
		const updateRun = await chainlink.updateJobRun(auth.incomingToken, data);
		if (!updateRun.errors){
			console.info(`Updated job run with ID ${updateRun.data.attributes.id} status: ERRORED`);
		}else{
			throw updateRun.errors;
		}
	});
}

/* Runs the setup script and checks if the Chainlink Node auth data is present */
async function setupCredentials(){
	return new Promise(async function(resolve, reject){
		try {
			if (process.env.DATABASE_URL) {
				const proc = exec('npm run setup', async (error, stdout, stderr) => {
					if (!error){
						const result = await db.query('SELECT * FROM auth_data');
						if (result.rows.length > 0){
							resolve();
						}else{
							reject('No auth data present');
						}
					}else{
						reject(error);
					}
				});
				proc.stdout.on('data', function(data) {
					process.stdout.write(data);
				});
			}else{
				console.error('DATABASE_URL environment variable is not set. Exiting...');
				reject();
			}
		}catch(e){
			console.error(e);
			reject(e);
		}
	});
}

/* Creates a new web3 instance connected to the specified network */
function setupNetwork(node){
	return new Promise(async function(resolve, reject){
		console.info(`Waiting for ${node.name} node to be ready, connecting to ${node.url}`);
		// Wrap the process in a function to be able to call it again if can't connect
		(function tryConnect() {
			const wsOptions = {
				clientConfig: {
					keepAlive: true,
					keepaliveInterval: 20000
				},
				reconnect: {
					auto: true,
					delay: 5000, // ms
					onTimeout: false
				}
			};
			const wsProvider = new Web3.providers.WebsocketProvider(node.url, wsOptions);
			web3.setProvider(wsProvider);
			// Check connection with isListening()
			web3.eth.net.isListening().then(() => {
				resolve(web3);
			}).catch(e => {
				// If error, print it and try to connect again after 10 seconds
				console.error(`Could not connect to ${node.name} node, retrying in 10 seconds...`)
				console.error(e);
				setTimeout(tryConnect, 10000);
			});
		})();
	}).catch(e => {
		reject(e);
	});
}

const server = app.listen(port, async function() {
	console.info(`RSK TX Adapter listening on port ${port}!`);
	try {
		await setupCredentials();
	}catch(e){
		console.error(e);
		process.exit();
	}
	adapterSetup();
});
