const ChainlinkAPIClient = require('chainlink-api-client');
const fs = require('fs');
const db = require('./db.js');

const INITIATOR_NAME = 'rskinitiator';

let chainlinkEmail, chainlinkPass;
[ chainlinkEmail, chainlinkPass ] = fs.readFileSync('./.api', 'utf8').trim().split("\n");

const chainlink = new ChainlinkAPIClient({
	email: chainlinkEmail,
	password: chainlinkPass,
	basePath: process.env.CHAINLINK_BASE_URL || 'http://localhost:6688'
});

runUninstall();

async function runUninstall(){
	await chainlink.login();
	const result = await chainlink.deleteInitiator(INITIATOR_NAME);
	if (!result.errors){
		if (typeof result.data !== 'undefined' && result.data == '204 No Content'){
			console.log('[INFO] - RSK Initiator successfully removed from Chainlink node.');
			await deleteCredentials();
		}else{
			console.log(result);
		}
	}else{
		console.log(result.errors);
		if (typeof result.errors[0].detail !== 'undefined' && result.errors[0].detail == "external initiator not found"){
			await deleteCredentials();
		}
	}
	await chainlink.logout();
	process.exit();
}

async function deleteCredentials(){
	return new Promise (async function(resolve, reject){
		try {
			const sqlDelete = `
				TRUNCATE TABLE auth_data;
			`;
			await db.query(sqlDelete);
			console.log('[INFO] - Auth credentials on database have been deleted.');
			resolve(true);
		}catch(e){
			console.log(e);
			reject(e);
		}
	});
}
