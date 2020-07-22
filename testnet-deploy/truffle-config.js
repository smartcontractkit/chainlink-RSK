const fs = require('fs');
const HDWalletProvider = require('@truffle/hdwallet-provider');
const deployerKey = fs.readFileSync(".deployerKey").toString().trim();
const Web3 = require('web3');

const rskNode = 'YOUR_NODE_RPC_URL';

/* Truffle config object */
module.exports = {
	contracts_directory: '../test-runner/src/contracts',
	networks: {
		rskTestnet: {
			provider: () => new HDWalletProvider(deployerKey, rskNode),
			network_id: 31,
			networkChecktimeout: 10000,
			gas: 5000000,
			url: rskNode,
			websockets: true
		}
	},
	compilers: {
		solc: {
			version: "0.5.0",
			settings: {
				optimizer: {
					enabled: true,
					runs: 200
				}
			}
		}
	}
}
