const fs = require('fs');
const Oracle = artifacts.require("Oracle");

const SIDETOKEN_ADDRESS = '0x8bBbd80981FE76d44854D8DF305e8985c19f0e78';
const ADAPTER_ADDRESS = 'YOUR_ADAPTER_ACCOUNT_ADDRESS';

module.exports = async function(deployer) {
	return deployer.deploy(Oracle, SIDETOKEN_ADDRESS).then(oracle => {
		// Allow the RSK TX Adapter wallet to fulfill Oracle's requests
		return oracle.setFulfillmentPermission(ADAPTER_ADDRESS, true);
	});
};
