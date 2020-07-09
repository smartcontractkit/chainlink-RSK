const bodyParser = require('body-parser');
const cbor = require('cbor');
const ChainlinkAPIClient = require('chainlink-api-client');
const express = require('express');
const fs = require('fs');
const Web3 = require('web3');

// The OracleRequest event ABI for decoding the event logs
const oracleRequestAbi = [{"indexed":true,"name":"specId","type":"bytes32"},{"indexed":false,"name":"requester","type":"address"},{"indexed":false,"name":"requestId","type":"bytes32"},{"indexed":false,"name":"payment","type":"uint256"},{"indexed":false,"name":"callbackAddr","type":"address"},{"indexed":false,"name":"callbackFunctionId","type":"bytes4"},{"indexed":false,"name":"cancelExpiration","type":"uint256"},{"indexed":false,"name":"dataVersion","type":"uint256"},{"indexed":false,"name":"data","type":"bytes"}];

const app = express();
const port = process.env.INITIATOR_PORT || 30055;

/* The configuration file should hold the authentication data. In testing environment it doesn't matter if it
   is present or not at first, because the test runner will provide one later. When working outside the testing
   environment, the configuration file should be present or else it will fail later when it needs to trigger a
   job run and has no authentication credentials available. */
const CONFIGURATION_FILE = '../config/config.json';

// If there aren't subscriptions, there will be provided later through the /initiator endpoint.
const SUBSCRIPTIONS_FILE = '../config/subscriptions.json';

let web3 = new Web3();
// The Subscriptions array holds the current job/oracle pairs that needs to be watched for events
let Subscriptions = [];
// The Events array holds the current unique events being processed. Allows for handling repeated events.
let Events = [];
// The auth object holds the initiator auth credentials for triggering job runs
let auth = {'incomingAccessKey': '', 'incomingSecret': ''};

// Setup different configurations if the project is running from inside a Docker container. If not, use defaults
const RSK_NODE = {
	host: process.env.RSK_HOST || 'localhost',
	port: process.env.RSK_WS_PORT || 4445,
	url: process.env.RSK_WS_URL || '/websocket'
};
const RSK_CONFIG = {
	'name': 'RSK',
	'shortname': 'regtest',
	'url': `ws://${RSK_NODE.host}:${RSK_NODE.port}${RSK_NODE.url}`
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

			// Subscribe to RSK node for events from that Oracle corresponding to that new job id
			newSubscription(req.body.jobId, req.body.params.address);

			// Save subscriptions list to a file.
			// TODO: Save subscriptions list to a database.
			console.log(`[INFO] - Saving subscriptions list...`);
			const saveSub = await writeJson(SUBSCRIPTIONS_FILE, Subscriptions);
			if (!saveSub.error){
				// Return 200 to Chainlink node
				return res.sendStatus(200);
			}else{
				throw error;
			}
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
		// Configures the web3 instance connected to RSK network
		web3 = await setupNetwork(RSK_CONFIG);
		const chainId = await web3.eth.net.getId();
		console.log(`[INFO] - Web3 is connected to the ${RSK_CONFIG.name} node. Chain ID: ${chainId}`);

		// Try to load the subscriptions file
		let subs = await loadJson(SUBSCRIPTIONS_FILE);
		if (!subs.error){
			console.log('[INFO] - Loaded subscriptions from file');
			Subscriptions = subs;
			Subscriptions.forEach(jobSub => {
				newSubscription(jobSub.jobId, jobSub.address);
			});
		}else{
			if (subs.error.indexOf('no such file or directory') == -1){
				console.error(e);
			}else{
				console.log('[INFO] - Subscriptions file not found, will wait for Chainlink to provide the first job');
			}
		}

		// Try to load the configuration file
		let config = await loadJson(CONFIGURATION_FILE);
		if (!config.error){
			console.log('[INFO] - Loaded authentication credentials from file');
			auth.incomingAccessKey = config.incomingAccessKey;
			auth.incomingSecret = config.incomingSecret;
		}else{
			if (config.error.indexOf('no such file or directory') == -1){
				console.error(e);
			}else{
				console.log('[INFO] - Configuration file not found, will wait to receive the auth info from test runner');
			}
		}
	}catch(e){
		console.error('[ERROR] - Initiator setup failed:' + e);
	}
}

/* Returns true if the event received has already been processed (is present in the Events array) */
function isDuplicateEvent(event){
	if (Events.length > 0){
		for (let x = 0; x < Events.length; x++){
			if (Events[x].transactionHash == event.transactionHash && Events[x].data == event.data && Events[x].topics == event.topics){
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

/* Subscribes to the RSK node for events emitted from the given Oracle address that contains a request
   for the specified job ID */
function newSubscription(jobId, oracleAddress){
	console.log(`[INFO] - Subscribing to Oracle at ${oracleAddress} for requests to job ID ${jobId}...`);
	/* TODO: Subscriptions are not working as expected with RSK node, address field is not working as filter
	   so it receives all events and have to manually filter through all events */
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
						const eventPos = Events.length - 1;
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

						// If the auth credentials hasn't been initialized already, try to load them from the config file
						// If the configuration file is not present, will fail
		    			if (auth.incomingAccessKey == '' || auth.incomingSecret == ''){
		    				const conf = await loadJson(CONFIGURATION_FILE);
		    				auth.incomingAccessKey = conf.incomingAccessKey;
		    				auth.incomingSecret = conf.incomingSecret;
		    			}
		    			
		    			// Trigger the job run, passing auth credentials and the complete request
		    			const newRun = await chainlink.initiateJobRun(jobId, auth.incomingAccessKey, auth.incomingSecret, clReq);
						if (!newRun.errors){
							console.log(`[INFO] - Initiated job run with ID ${newRun.data.attributes.id}...`);
						}else{
							throw newRun.errors;
						}
						// Give it some time to wait for possible incoming repeated events, then remove it from array
						setTimeout(() => {
							Events.splice(eventPos, 1);
						}, 20000);
		    		}else{
		    			console.log('[INFO] - Oracle requested for a job ID not registered on Initiator database, skipping...');
		    		}
				}catch(e){
					console.error(e);
				}
			}
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

/* Writes a json file */
function writeJson(file, data){
	return new Promise(function (resolve, reject){
		fs.writeFile(file, JSON.stringify(data), 'utf8', (err) => {
			if (err){
				console.error(err);
				resolve({'error':err.toString()});
			}else{
				resolve({});
			}
		});
	});
}

const server = app.listen(port, function() {
	console.log(`[INFO] - RSK Initiator listening on port ${port}!`);
	initiatorSetup();
});
