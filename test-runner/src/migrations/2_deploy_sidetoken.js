const SideToken_v1 = artifacts.require("SideToken_v1");
require('@openzeppelin/test-helpers/configure')({
	provider: web3.currentProvider,
	environment: 'truffle',
	singletons: {
		abstraction: 'truffle',
	}
});
const {
  ERC1820_REGISTRY_DEPLOY_TX
} = require('@openzeppelin/test-helpers/src/data');
const { singletons } = require('@openzeppelin/test-helpers');

const name = "LinkToken";
const symbol = "LINK";
const granularity = 1;

module.exports = async function(deployer, network, accounts) {
	try {
		const erc1820 = await singletons.ERC1820Registry(accounts[0]);
	}catch(e){
		// Workaround if singletons lib can't deploy the registry, send funds and deploy it through the deploy tx directly, then instance normally
		await web3.eth.sendTransaction({from: accounts[0], to: '0xa990077c3205cbDf861e17Fa532eeB069cE9fF96', value: "1000000000000000000"});
		await web3.eth.sendSignedTransaction(ERC1820_REGISTRY_DEPLOY_TX);
		const erc1820 = await singletons.ERC1820Registry(accounts[0]);
	}

	return deployer.deploy(SideToken_v1).then(sideToken => {
		return sideToken.initialize(name, symbol, accounts[0], granularity);
	});

};
