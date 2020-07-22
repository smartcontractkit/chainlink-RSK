/* Script that requests RIF/BTC price to the Consumer contract */

const Consumer = artifacts.require("Consumer");

module.exports = async function(callback) {
	try {
		const consumer = await Consumer.deployed();
		const payment = "1000000000000000000";
		console.log('[INFO] - Requesting RIF Price...');
		const result = await consumer.requestRIFPrice(payment);
		// Watch for the RequestFulfilled event of the Consumer contract
		console.log('[INFO] - Waiting for receipt...');
		const waitTX = setInterval(async () => {
			const receipt = await web3.eth.getTransactionReceipt(result.tx);
			if (receipt){
				clearInterval(waitTX);
				pollResponse(receipt.blockNumber + 1, consumer);
			}
		}, 5000);	
	}catch(e){
		console.error(e);
		throw(e);
	}

	async function pollResponse(fromBlock, consumer){
		console.log('[INFO] - Polling for the response...');
		const poll = setInterval(async () => {
			web3.eth.getPastLogs({
				'address': consumer.address,
				'topics': [],
				'fromBlock': web3.utils.toHex(fromBlock)
			}).then(function(events){
				if (events.length > 0){
					clearInterval(poll);
					consumer.currentPrice().then(function(price){
						const priceNum = web3.utils.hexToNumber(price);
						if (priceNum !== 0){
							console.log('[INFO] - Received RIF price: ' + (priceNum / 100000000) + ' BTC');
							return callback();
						}
					});
				}
			});
		}, 10000);
	}
}