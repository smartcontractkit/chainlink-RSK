const { exec } = require('child_process');
const ChainlinkAPIClient = require('chainlink-api-client');
const contract = require('@truffle/contract');
const external = require('./external.js');
const fs = require('fs');
const HDWalletProvider = require('@truffle/hdwallet-provider');
const Web3 = require('web3');

const TESTER_PRIVATE_KEY = fs.readFileSync(".testerKey").toString().trim();
const CONTRACTS_BUILD_DIRECTORY = process.env.CONTRACTS_BUILD_DIRECTORY || './build/contracts';
const CONFIGURATION_FILE = '../config/config.json';
const SUBSCRIPTIONS_FILE = '../config/subscriptions.json';
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

let chainlinkEmail, chainlinkPass;
try {
	[ chainlinkEmail, chainlinkPass ] = fs.readFileSync('/run/secrets/chainlink_api', 'utf8').trim().split("\n");
}catch(e){
	[ chainlinkEmail, chainlinkPass ] = fs.readFileSync('./.api', 'utf8').trim().split("\n");
}

const chainlink = new ChainlinkAPIClient({
	email: chainlinkEmail,
	password: chainlinkPass,
	basePath: process.env.CHAINLINK_BASE_URL || 'http://localhost:6688'
});

// Initialize test environment and run the test
initTestRunner();

/* Deploy a specified contract to the provided network */
function deploy(name, network, provider){
	return new Promise(async function(resolve, reject){
		console.log(`[INFO] - Deploying ${name} contract...`);
		// Run truffle migrate command from npm script
		exec(`npm run deploy:${name.toLowerCase()}:${network}`, (error, stdout, stderr) => {
			console.log(`[INFO] - Deploy of ${name} executed`);
			if (!error){
				// If completed without errors, read the truffle artifacts file
				loadArtifacts(name).then(contractArtifacts => {
					// Create a contract instance, connect to provider and resolve
					const abs = contract(contractArtifacts);
					abs.setProvider(provider);
					abs.deployed().then(instance => {
						resolve(instance);
					});
				}).catch(e => {
					reject(e);
				});
			}else{
				reject(error);
			}
		// Send the truffle stdout to the node stdout
		}).stdout.on('data', function(data) {
			process.stdout.write(data);
		});
	});
}

/* Run the fund script using the specified network */
function fund(network){
	return new Promise(async function(resolve, reject){
		console.log('[INFO] - Funding test runner accounts...');
		exec(`npm run fund:${network}`, (error, stdout, stderr) => {
			if (!error){
				resolve(true);
			}else{
				reject(error);
			}
		}).stdout.on('data', function(data) {
			process.stdout.write(data);
		});
	});
}

/* Run the consumer fund script using the specified network */
function fundConsumer(network){
	return new Promise(async function(resolve, reject){
		console.log('[INFO] - Funding Consumer contract with LINK...');
		exec(`npm run fund:consumer:${network}`, (error, stdout, stderr) => {
			if (!error){
				resolve(true);
			}else{
				reject(error);
			}
		}).stdout.on('data', function(data) {
			process.stdout.write(data);
		});
	});	
}

/* Initializes the Chainlink node with the configuration needed for the test */
async function initCore(oracleAddress){
	return new Promise(async function (resolve, reject){
		try {
			const initiatorAuth = await setupInitiator();
			const adapterAuth = await setupAdapter();
			const newJobId = await setupJob(oracleAddress);
			await chainlink.logout();

			const conf = {
				'incomingAccessKey': initiatorAuth.incomingAccessKey,
				'incomingSecret': initiatorAuth.incomingSecret,
				'incomingToken': adapterAuth.incomingToken,
				'jobId': newJobId
			};

			fs.writeFile(CONFIGURATION_FILE, JSON.stringify(conf), 'utf8', err => {
				if (err) throw err;
				resolve(conf);
			});
		}catch(e){
			reject(e);
		}
	});
}

/* The main function of the tester. It initializes the testing environment, first deploying a SideToken contract and
   an Oracle contract. Then configures the Chainlink node, creating the initiator and adapter bridges and a job that
   uses them. Once the Chainlink node is ready, it deploys a Consumer contract configured with the previously
   deployed SideToken and Oracle contracts, and the previously created job. Then mints tokens and send some
   to the Consumer contract. Finally it calls the requestRIFPrice of the Consumer contract and then polls for
   current price. */
async function initTestRunner(){
	try {
		// Connect web3 with RSK network
		const web3 = await setupNetwork(RSK_CONFIG);
		const chainId = await web3.eth.net.getId();
		console.log(`[INFO] - Web3 is connected to the ${RSK_CONFIG.name} node. Chain ID: ${chainId}`);
		
		// Deploy SideToken or instantiate previously deployed contract
		const SideToken_v1 = await setupContract('SideToken_v1', RSK_CONFIG, chainId, web3.currentProvider);
		console.log(`[INFO] - Deployed SideToken_v1 contract address in ${RSK_CONFIG.name} network is: ${SideToken_v1.address}`);

		// Deploy Oracle or instantiate previously deployed contract
		const Oracle = await setupContract('Oracle', RSK_CONFIG, chainId, web3.currentProvider);
		console.log(`[INFO] - Deployed Oracle contract address in ${RSK_CONFIG.name} network is: ${Oracle.address}`);

		// Configure Chainlink node
		const chainlinkData = await setupChainlinkNode(Oracle.address);

		// Deploy Consumer or instantiate previously deployed contract
		const Consumer = await setupContract('Consumer', RSK_CONFIG, chainId, web3.currentProvider);
		console.log(`[INFO] - Deployed Consumer contract address in ${RSK_CONFIG.name} network is: ${Consumer.address}`);

		// Check if Consumer contract has tokens, if not, mint and fund it
		const consumerBalance = await SideToken_v1.balanceOf(Consumer.address);
		if (consumerBalance == "0"){
			await mint(RSK_CONFIG.shortname);
			await fundConsumer(RSK_CONFIG.shortname);
		}

		const accounts = await web3.eth.getAccounts();
		console.log('[INFO] - Adapter account is ' + accounts[0]);
		const rbtcBalance = await web3.eth.getBalance(accounts[0]);
		console.log('[INFO] - Adapter account balance: ' + web3.utils.fromWei(rbtcBalance, 'ether') + ' RBTC');

		// Request RIF/BTC price to the Consumer
		const payment = "1000000000000000000";	
		console.log('[INFO] - Requesting RIF Price to Consumer contract...');
		let result2 = await Consumer.requestRIFPrice(payment, {from: accounts[0]}).then(function(result){
			// Poll for current price every 5 seconds
			let waitResult = setInterval(() => {
				Consumer.currentPrice().then(function(price){
					const priceNum = web3.utils.hexToNumber(price);
					if (priceNum !== 0){
						console.log('[INFO] - Received RIF price: ' + (priceNum / 100000000) + ' BTC');
						clearInterval(waitResult);
					}
				});
			}, 5000);
		});
	}catch(e){
		console.error('[ERROR] - Test Runner initialization failed:' + e);
	}
}

/* Checks if a given contract's artifact exists in Truffle build folder */
function isContractCompiled(contractName){
	return new Promise(async function(resolve, reject){
		const path = `${CONTRACTS_BUILD_DIRECTORY}/${contractName}.json`;
		fs.exists(path, function(exists){
			resolve(exists);
		});
	});
}

/* Checks if a contract is already deployed in the provided network */
function isContractDeployed(contractName, provider){
	return new Promise(async function(resolve, reject){
		loadArtifacts(contractName).then(contractArtifacts => {
			var abs = contract(contractArtifacts);
			abs.setProvider(provider);
			abs.deployed().then(instance => {
				resolve(instance);
			}).catch(e => {
				if (e.toString().indexOf('has not been deployed to detected network') > -1){
					resolve('not deployed');
				}else{
					reject(e);
				}
			});
		}).catch(e => {
			reject(e);
		});
	});
}

/* Loads a Truffle artifact file and returns the parsed object */
function loadArtifacts(contractName){
	return new Promise(async function(resolve, reject){
		fs.readFile(`${CONTRACTS_BUILD_DIRECTORY}/${contractName}.json`, 'utf8', (error, contractArtifacts) => {
			if (!error){
				resolve(JSON.parse(contractArtifacts));
			}else{
				reject(error);
			}
		});
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

/* Run the mint script */
function mint(network){
	return new Promise(async function(resolve, reject){
		exec(`npm run mint:${network}`, (error, stdout, stderr) => {
			if (!error){
				resolve(true);
			}else{
				reject(error);
			}
		}).stdout.on('data', function(data) {
			process.stdout.write(data);
		});
	});
}


/* Configures a Chainlink node with an external adapter. First tries to create the adapter, if already
   exists, tries to load incoming token from file. Returns the adapter incoming token */
function setupAdapter(){
	return new Promise(async function(resolve, reject){
		const newBridge = await chainlink.createBridge(external.ADAPTER_NAME, external.ADAPTER_URL);
		if (!newBridge.errors){
			console.log(`[INFO] - Successfully created ${external.ADAPTER_NAME} bridge`);
			const authInfo = {
				incomingToken: newBridge.data.attributes.incomingToken
			} 
			resolve(authInfo);
		}else{
			// If the adapter is already created, read config from previously saved config file
			if (newBridge.errors[0].detail.indexOf("already exists") > -1){
				console.log(`[INFO] - ${external.ADAPTER_NAME} already exists, reading incoming token from file...`);
				fs.readFile(CONFIGURATION_FILE, 'utf8', (err, data) => {
					if (!err){
						const jsonData = JSON.parse(data);
						const authInfo = {
							incomingToken: jsonData.incomingToken
						}
						resolve(authInfo);
					}else{
						reject(err);
					}
				});
			}else{
				reject(JSON.stringify(newBridge.errors));
			}
		}
	});
}

/* Configures a Chainlink node with an initiator, adapter and job needed for running the tests,
   first checks if they've been previously created, if not it creates them */
function setupChainlinkNode(oracleAddress){
	return new Promise(async function(resolve, reject) {
		try {
			await chainlink.login();
			// Check if job list has something
			const jobList = (await chainlink.getJobs()).data;
			if (jobList.length > 0){
				// There's at least one job created, so check if there's a config file already created
				const jobConflict = 'Created job not equal to registered job in file';
				try {
					const data = fs.readFileSync(CONFIGURATION_FILE, 'utf8');
					const config = JSON.parse(data);
					// If there's a config file created but the job saved is different that the job
					// in the list, then throw exception
					if (jobList[0].id !== config.jobId) throw jobConflict;
					// If everything is ok, then resolve with the previously saved config
					await chainlink.logout();
					resolve(config);
				}catch(e){
					// If the exception is the job conflict, then reinstall everything, else, there's
					// something else going on, so throw
					if (e == jobConflict || e.toString().indexOf('no such file or directory') !== -1){
						// Job is found in chainlink but config file doesn't, so remove everything and start over
						const config = await reinstall(oracleAddress);
						resolve(config);
					}else{
						throw e;
					}
				}
			}else{
				// No jobs found, init the configuration
				const config = await initCore(oracleAddress);
				resolve(config);
			}
		}catch(e){
			console.error(e);
			reject(e);
		}
	});
}

/* Configures an initiator on the Chainlink node, and returns the authentication credentials
   that will be used for triggering job runs through the external initiator */
function setupInitiator(){
	return new Promise(async function(resolve, reject){
		// Try to create an initiator
		const newInit = await chainlink.createInitiator(external.INITIATOR_NAME, external.INITIATOR_URL);
		if (!newInit.errors){
			console.log(`[INFO] - Successfully created ${external.INITIATOR_NAME} initiator`);
			const authInfo = {
				incomingAccessKey: newInit.data.attributes.incomingAccessKey,
				incomingSecret: newInit.data.attributes.incomingSecret
			}
			resolve(authInfo);
		}else{
			// If the initiator already exists, then a config file must have been created with the
			// authentication credentials, so read it. If there's another type of error, then reject
			if (newInit.errors[0].detail.indexOf("already exists") !== -1){
				console.log(`[INFO] - ${external.INITIATOR_NAME} already exists, reading auth credentials from file...`);
					fs.readFile(CONFIGURATION_FILE, 'utf8', (err, data) => {
						if (!err){
							const jsonData = JSON.parse(data);
							const authInfo = {
								incomingAccessKey: jsonData.incomingAccessKey,
								incomingSecret: jsonData.incomingSecret
							}
							resolve(authInfo);
						}else{
							reject(err);
						}
					});
			}else{
				reject(JSON.stringify(newInit.errors));
			}
		}
	});
}

/* Configures a Job on the Chainlink node, reading the specs from the external.js file
   and configuring the initiator to listen for events on the previously deployed Oracle contract address,
   returns the newly created job ID */
function setupJob(oracleAddress){
	return new Promise(async function(resolve, reject){
		let initiatorData = external.JOB_SPEC.initiators;
		// Add the Oracle contract address to the params' body before sending the job spec to Chainlink
		initiatorData[0].params.body.address = oracleAddress;
		const newJob = await chainlink.createJob(initiatorData, external.JOB_SPEC.tasks);
		if (!newJob.errors){
			console.log(`[INFO] - Successfully created a new job with id ${newJob.data.id}`);
			resolve(newJob.data.id);
		}else{
			reject(JSON.stringify(newJob.errors));
		}
	});
}

/* Creates a new web3 instance connected to the specified network */
function setupNetwork(node){
	return new Promise(async function(resolve, reject){
		console.log(`[INFO] - Waiting for ${node.name} node to be ready, connecting to ${node.url}`);
		// Wrap the process in a function to be able to call it again if can't connect
		(function tryConnect() {
			let web3_tmp = new Web3();
			let web3 = new Web3();
			// First use WebsocketProvider
			const wsProvider = new Web3.providers.WebsocketProvider(node.url);
			// Pass the 'on' event listeners from WebsocketProvider to HDWalletProvider
			HDWalletProvider.prototype.on = wsProvider.on.bind(wsProvider);
			// Set the WebsocketProvider as provider and check connection with isListening()
			web3_tmp.setProvider(wsProvider);
			web3_tmp.eth.net.isListening().then(() => {
				// Once the connection is established, use HDWalletProvider as provider
				// to be able to use the tester service private key, and wrap it around de wsProvider
				const provider = new HDWalletProvider(TESTER_PRIVATE_KEY, wsProvider);
				// Set the new provider, clear temporary web3 and resolve
				web3.setProvider(provider);
				web3_tmp = null;
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

/* Remove every configuration created, and init the core again */
function reinstall(oracleAddress){
	return new Promise(async function(resolve, reject){
		try {
			// Get job list from Chainlink and remove everything
			const jobList = (await chainlink.getJobs()).data;
			for (let x = 0; x < jobList.length; x++){
				console.log(`[INFO] - Archiving job ${jobList[x].id}...`);
				const res = await chainlink.archiveJob(jobList[x].id);
			}

			// Get bridges list from Chainlink
			const bridgesList = await chainlink.getBridges();
			// Checks if the RSK TX adapter exists, if it does then remove it
			const adapterExists = (element) => element.id == external.ADAPTER_NAME;
			if (bridgesList.some(adapterExists)){
				console.log(`[INFO] - Deleting bridge ${external.ADAPTER_NAME}...`);
				const res2 = await chainlink.deleteBridge(external.ADAPTER_NAME);
			}

			// Remove RSK Initiator
			console.log(`[INFO] - Deleting initiator ${external.INITIATOR_NAME}...`);
			const res3 = await chainlink.deleteInitiator(external.INITIATOR_NAME);

			// Delete configuration and subscriptions file
			console.log('[INFO] - Deleting configuration file...');
			fs.unlink(CONFIGURATION_FILE, (err) => {
				console.log('[INFO] - Deleting subscriptions file...');
				fs.unlink(SUBSCRIPTIONS_FILE, (err) => {
					// Delete Consumer contract artifacts to force truffle to migrate again
					console.log('[INFO] - Deleting Consumer contract artifacts...');
					fs.unlink(`${CONTRACTS_BUILD_DIRECTORY}/Consumer.json`, async (err) => {
						const conf = await initCore(oracleAddress);
						resolve(conf);
					})
				});
			});
		}catch(e){
			console.error(e);
		}
	});
}

/* Resolves the configuration of a contract and returns a Truffle Contract instance */
function setupContract(contractName, node, network, provider) {
	return new Promise(async function(resolve, reject) {
		console.log(`[INFO] - Setting up contract ${contractName}...`);
		// Check if the contract is already compiled
		isContractCompiled(contractName).then(function(exists){
			if (exists){
				// Check if the contract is already deployed
				isContractDeployed(contractName, provider).then(async instance => {
					if (instance == 'not deployed'){
						console.log(`[INFO] - ${contractName} contract is not deployed on required network (${network}). Deploying...`);
						if (contractName == 'SideToken_v1'){
							await fund(node.shortname);
						}
						// Deploy the contract and return the Truffle Contract instance
						deploy(contractName, node.shortname, provider).then(instance => {
							resolve(instance);
						}).catch(e => {
							reject(e);
						});
					}else{
						// Contract is already deployed, return the Truffle Contract instance
						resolve(instance);
					}
				}).catch(e => {
					reject(e);
				});
			}else{
				// If the contract is not compiled, will fund, compile and deploy
				console.log(`[INFO] - ${contractName} contract is not compiled. Will compile and deploy...`);
				fund(node.shortname).then(isFunded => {
					if (isFunded){
						deploy(contractName, node.shortname, provider).then(instance => {
							resolve(instance);
						}).catch(e => {
							reject(e);
						});
					}
				}).catch(e =>{
					reject(e);
				})
			}
		}).catch(e => {
			reject(e);
		});
	});
}
