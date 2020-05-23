/* Script that sends LINK tokens to the Consumer contract deployed by the test runner */

const Consumer = artifacts.require("Consumer");
const SideToken_v1 = artifacts.require("SideToken_v1");

module.exports = async function(callback) {
	try {
		const consumer = await Consumer.deployed();
		const sideToken = await SideToken_v1.deployed();

		const amount = 1000;
		const sendAmount = web3.utils.toWei(amount.toString(), 'ether');

		console.log(`[INFO] - Sending ${amount} tokens to Consumer contract at ${consumer.address}`);

		const tx = await sideToken.transfer(consumer.address, sendAmount);
		console.log('[INFO] - Funding TX: ' + tx.tx);
		console.log('');
		return callback();
	}catch(e){
		console.error(e);
		throw(e);
	}
}