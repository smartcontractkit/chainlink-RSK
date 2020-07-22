const bodyParser = require('body-parser');
const cbor = require('cbor');
const ChainlinkAPIClient = require('chainlink-api-client');
const { exec } = require('child_process');
const express = require('express');
const fs = require('fs');
const Web3 = require('web3');
const db = require('./db.js');

// The OracleRequest event ABI for decoding the event logs
const oracleRequestAbi = [{"indexed":true,"name":"specId","type":"bytes32"},{"indexed":false,"name":"requester","type":"address"},{"indexed":false,"name":"requestId","type":"bytes32"},{"indexed":false,"name":"payment","type":"uint256"},{"indexed":false,"name":"callbackAddr","type":"address"},{"indexed":false,"name":"callbackFunctionId","type":"bytes4"},{"indexed":false,"name":"cancelExpiration","type":"uint256"},{"indexed":false,"name":"dataVersion","type":"uint256"},{"indexed":false,"name":"data","type":"bytes"}];

const app = express();
const port = process.env.INITIATOR_PORT || 30055;

let web3 = new Web3();
// The Subscriptions array holds the current job/oracle pairs that needs to be watched for events
let Subscriptions = [];
// The Events array holds the current unique events being processed. Allows for handling repeated events.
let Events = [];

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

// Initialize the Chainlink API Client without credentials, the adapter will login through the access key and secret
let chainlink = new ChainlinkAPIClient({
	basePath: process.env.CHAINLINK_BASE_URL
});

app.use(bodyParser.json());

/* Simple logger middleware that prints the requests received on the initiator endpoints */
app.use(function (req, res, next) {
	console.log('[INFO] - Received ' + req.method + ' request on ' + req.baseUrl + req.originalUrl + ' URL');
	next();
});

/* Healthcheck endpoint */
app.get("/", (req, res) => {
	return res.sendStatus(200);
});

/* TODO: on delete request should delete the job from the subscriptions list */
app.delete('/initiator', (req, res) => {
	return res.sendStatus(200);
});

/* The main endpoint that receives new jobs to subscribe to */
app.post("/initiator", async (req, res) => {
	try {
		// Check for auth headers and return 401 if not present
		if (typeof req.headers['x-chainlink-ea-accesskey'] !== 'undefined' && typeof req.headers['x-chainlink-ea-secret'] !== 'undefined'){
			const outgoingAccessKey = req.headers['x-chainlink-ea-accesskey'];
			const outgoingSecret = req.headers['x-chainlink-ea-secret'];
			console.log('[INFO] - Received a new job from Chainlink');

			// TODO: Validate Chainlink auth credentials (outgoingAccessKey and outgoingSecret) and return 401 if not validated

			// Add the new job to the subscriptions list
			console.log(`[INFO] - Adding Job ${req.body.jobId} to the subscription list...`);
			Subscriptions.push({'jobId':req.body.jobId, 'address':req.body.params.address});

			// Save the new subscription to database
			console.log(`[INFO] - Saving subscription...`);
			await saveSubscription(req.body.jobId, req.body.params.address);

			// Subscribe to RSK node for events from that Oracle corresponding to that new job id
			newSubscription(req.body.jobId, req.body.params.address);

			return res.sendStatus(200);
		}else{
			return res.sendStatus(401);
		}
	}catch(e){
		// Print error and return 500 status code
		console.error(e);
		return res.sendStatus(500);
	}
});

/* Configures the initiator with a web3 instance connected to a RSK network and tries to load the
   subscriptions file and configuration file. */
async function initiatorSetup(){
	try {
		// Configure the web3 instance connected to RSK network
		web3 = await setupNetwork(RSK_CONFIG);
		const chainId = await web3.eth.net.getId();
		console.log(`[INFO] - Web3 is connected to the ${RSK_CONFIG.name} node. Chain ID: ${chainId}`);

		// Load the subscriptions from database
		let subs = await loadSubscriptions();
		if (subs.length > 0){
			console.log('[INFO] - Loaded subscriptions from database');
			subs.forEach(sub => {
				Subscriptions.push({
					'jobId': sub.job,
					'address': sub.address
				});
				newSubscription(sub.job, sub.address);
			});
		}else{
			console.log('[INFO] - No subscriptions yet');
		}
	}catch(e){
		console.error('[ERROR] - Initiator setup failed:' + e);
	}
}

/* Returns true if the event received has already been processed (is present in the Events array) */
function isDuplicateEvent(event){
	if (Events.length > 0){
		for (let x = 0; x < Events.length; x++){
			if (Events[x].transactionHash == event.transactionHash && Events[x].topics.toString() == event.topics.toString()){
				return true;
			}else{
				if ((x + 1) == Events.length){
					return false;
				}
			}
		}
	}else{
		return false;
	}
}

/* Reads the database and returns the Chainlink Node auth data */
function loadCredentials(){
	return new Promise(async function (resolve, reject){
		const result = await db.query('SELECT * FROM auth_data');
		if (result.rows.length > 0){
			const auth = {
				incomingAccessKey: result.rows[0].incoming_accesskey,
				incomingSecret: result.rows[0].incoming_secret
			};
			resolve(auth);
		}else{
			reject('No auth data present');
		}
	});
}

/* Loads the subscriptions list from database */
async function loadSubscriptions(){
	return new Promise(async function(resolve, reject){
		try {
			const sql = 'SELECT * FROM subscriptions;';
			const result = await db.query(sql);
			resolve(result.rows);
		}catch(e){
			console.log(e);
			reject(e);
		}
	});
}

/* Subscribes to the RSK node for events emitted from the given Oracle address that contains a request
   for the specified job ID */
async function newSubscription(jobId, oracleAddress){
	console.log(`[INFO] - Subscribing to Oracle at ${oracleAddress} for requests to job ID ${jobId}...`);
	const currentBlock = await web3.eth.getBlockNumber();
	let subscription = web3.eth.subscribe('logs', {
		address: oracleAddress,
		fromBlock: web3.utils.toHex(currentBlock)
	}, async function(error, event){
		if (!error)
			// If the event comes from the given Oracle address
			if (event.address == oracleAddress){
				try {
					// Decode the event logs
					const logs = web3.eth.abi.decodeLog(oracleRequestAbi, event.data, event.topics);
					const specId = web3.utils.hexToUtf8(event.topics[1]);
					// If the request is for the specified job and is not a duplicate event
					if (jobId == specId && !isDuplicateEvent(event)){
						console.log(`[INFO] - New Oracle request with ID ${logs.requestId}. Triggering job ${specId}...`);
						// Save the event in the Events array to allow for checking duplicates
						Events.push(event);
						// If there's request data present in the logs, then extract and decode it
						let clReq;
						if (logs.data !== null){
							// Extract the CBOR data buffer from the log, adding the required initial and final bytes for proper format
							const encodedReq = new Buffer.from(('bf' + logs.data.slice(2) + 'ff'), 'hex');
							// Decode the Chainlink request from the CBOR data buffer
							clReq = await cbor.decodeFirst(encodedReq);
						}else{
							clReq = {};
						}
						/* Add to the request some custom parameters destined for the RSK TX adapter:
						   @address is the address of the Oracle contract that the adapter has to call
						   @dataPrefix is the encoded parameters that the adapter will need to call the Oracle
						   @functionSelector is the selector of the Oracle fulfill function */
						clReq.address = oracleAddress;
						clReq.dataPrefix = web3.eth.abi.encodeParameters([
								'bytes32', 'uint256', 'address', 'bytes4', 'uint256'
							],[
								logs.requestId, logs.payment, logs.callbackAddr, logs.callbackFunctionId, logs.cancelExpiration
							]
						);
						// 0x4ab0d190 is the selector for the Oracle fulfillRequest() function
						clReq.functionSelector = '0x4ab0d190';
						// Load auth credentials from database
						const auth = await loadCredentials();
						// Trigger the job run, passing auth credentials and the complete request
						const newRun = await chainlink.initiateJobRun(jobId, auth.incomingAccessKey, auth.incomingSecret, clReq);
						if (!newRun.errors){
							console.log(`[INFO] - Initiated job run with ID ${newRun.data.attributes.id}...`);
						}else{
							throw newRun.errors;
						}
						// Give it some time to wait for possible incoming repeated events, then remove it from array
						setTimeout(() => {
							Events.splice(0, 1);
						}, 40000);
					}else{
						console.log('[INFO] - Detected duplicate event, skipping...');
					}
				}catch(e){
					console.error(e);
				}
			}
	});
}

/* Saves a new subscription to database */
async function saveSubscription(jobId, oracleAddress){
	return new Promise(async function(resolve, reject){
		try {
			const sqlInsert = `
				INSERT INTO subscriptions (address, job)
				VALUES ('${oracleAddress}', '${jobId}');
			`;
			const result = await db.query(sqlInsert);
			resolve(true);
		}catch(e){
			console.log(e);
			reject(e);
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
				proc.stdout.on('data', (data) => {
					process.stdout.write(data);
				});
			}else{
				console.error('[ERROR] - DATABASE_URL environment variable is not set. Exiting...');
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
		console.log(`[INFO] - Waiting for ${node.name} node to be ready, connecting to ${node.url}`);
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
					maxAttempts: 5,
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
				console.error(`[ERROR] - Could not connect to ${node.name} node, retrying in 10 seconds...`)			
				console.error(e);
				setTimeout(tryConnect, 10000);
			});
		})();
	}).catch(e => {
		reject(e);
	});
}

const server = app.listen(port, async function() {
	console.log(`[INFO] - RSK Initiator listening on port ${port}!`);
	try {
		await setupCredentials();
	}catch(e){
		console.log(e);
		process.exit();
	}
	initiatorSetup();
});
