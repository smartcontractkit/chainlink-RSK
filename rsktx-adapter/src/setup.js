const ChainlinkAPIClient = require('chainlink-api-client');
const fs = require('fs');
const db = require('./db.js');

const ADAPTER_HOST = process.env.ADAPTER_HOST || 'localhost';
const ADAPTER_NAME = process.env.ADAPTER_NAME || 'rsktxadapter';
const ADAPTER_PORT = process.env.ADAPTER_PORT || 30056;
const ADAPTER_URL = `http://${ADAPTER_HOST}:${ADAPTER_PORT}/adapter`;

let chainlinkEmail, chainlinkPass;
[ chainlinkEmail, chainlinkPass ] = fs.readFileSync('./.api', 'utf8').trim().split("\n");

const chainlink = new ChainlinkAPIClient({
	email: chainlinkEmail,
	password: chainlinkPass,
	basePath: process.env.CHAINLINK_BASE_URL || 'http://localhost:6688'
});

runSetup();

async function initDb(){
	return new Promise(async function(resolve, reject){
		try {
			const sqlCreate = `
				CREATE TABLE auth_data (
					incoming_token VARCHAR(32)
				);
				CREATE TABLE transactions (
					id SERIAL PRIMARY KEY,
					txhash VARCHAR(42),
					job VARCHAR(32)
				);
			`;
			await db.query(sqlCreate);
			console.log('[INFO] - Database tables created successfully, registering Adapter with Chainlink Node...');
			await install();
			console.log('[INFO] - Adapter registered successfully!');
			resolve(true);
		}catch(e){
			console.log(e);
			reject(e);
		}
	});
}

async function install(){
	return new Promise (async function(resolve, reject){
		await chainlink.login();
		const newBridge = await chainlink.createBridge(process.env.ADAPTER_NAME, ADAPTER_URL);
		if (!newBridge.errors){
			try {
				console.log(`[INFO] - Successfully created ${process.env.ADAPTER_NAME} adapter`);
				const sqlInsert = `
					INSERT INTO auth_data (incoming_token)
					VALUES ('${newBridge.data.attributes.incomingToken}');
				`;
				const result = await db.query(sqlInsert);
				console.log('[INFO] - Auth config successfully saved');
				resolve(true);
			}catch(e){
				console.log(e);
			}
		}else{
			console.log(JSON.stringify(newBridge.errors));
		}
		await chainlink.logout();		
	});
}

async function runSetup(){
	try {
		const result = await db.query('SELECT * FROM auth_data');
		if (result.rows.length > 0){
			console.log('[INFO] - Authentication data found');
		}else{
			console.log('[INFO] - Database exists but authentication data is not found, running install...');
			await install();
		}
	}catch(e){
		if (e.toString().indexOf('relation "auth_data" does not exist') > -1){
			console.log('[INFO] - Creating database tables...');
			await initDb();
		}else{
			console.log(e);
		}
	}
	process.exit();
}
