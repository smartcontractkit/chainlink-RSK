/* Script that sends funds to the accounts used in the tests. For quick automatic
   configuration, it imports the keys of the wallets that the services uses,
   extracts the addresses and funds them all */

const fs = require('fs');

const deployerKey = fs.readFileSync("../.deployerKey").toString().trim();
const testerKey = fs.readFileSync("../.testerKey").toString().trim();
const adapterKey = fs.readFileSync("/run/secrets/adapter_key").toString().trim();

module.exports = async function(callback) {
	try {
		const network = process.argv[5];

		web3.eth.accounts.wallet.add({privateKey: '0x' + deployerKey});
		web3.eth.accounts.wallet.add({privateKey: '0x' + adapterKey});
		web3.eth.accounts.wallet.add({privateKey: '0x' + testerKey});

		const nodeAccounts = await web3.eth.getAccounts();
		const nodeAccount = nodeAccounts[0];
		console.log('Using ' + network + ' node account: ' + nodeAccount);

		for (var x = 0; x < web3.eth.accounts.wallet.length; x++){
			const account = web3.eth.accounts.wallet[x].address;
			console.log('Funding ' + network + ' account: ' + account);
					
			var txParams = {
				from: nodeAccount,
				to: account,
				gasPrice: 0,
				value: "10000000000000000000000"
			};

			const tx = await web3.eth.sendTransaction(txParams);
			console.log('Mining TX: ' + tx.transactionHash);

			const pollTx = setInterval(function(){
				web3.eth.getTransactionReceipt(tx, function(error, receipt){
					if (receipt != null){
						console.log(receipt);
						clearInterval(pollTx);
					}
				})
			}, 5000);
		}
		console.log('');
		return callback();
	}catch(e){
		console.error(e);
		return callback();
	}
}