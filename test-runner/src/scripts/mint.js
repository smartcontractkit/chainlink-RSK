/* Script for minting LINKs on the SideToken contract, that will
   be used for the test run */

const SideToken_v1 = artifacts.require("SideToken_v1");

module.exports = async function(callback) {
	try {
		const account = web3.currentProvider.addresses[0];
		const sideToken = await SideToken_v1.deployed();
		const amount = 10000;
		const mintAmount = web3.utils.toWei(amount.toString(), 'ether');

		console.log(`[INFO] - Minting ${amount} Tokens...`);

		const tx = await sideToken.mint(account, mintAmount, '0x0', '0x0');
		console.log('[INFO] - Mint TX: ' + tx.tx);
		console.log('');
		return callback();
	}catch(e){
		console.error(e);
		throw(e);
	}
}
