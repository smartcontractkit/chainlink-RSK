const ChainlinkAPIClient = require('chainlink-api-client');
const fs = require('fs');
const db = require('./db.js');

const INITIATOR_HOST = process.env.INITIATOR_HOST || 'localhost';
const INITIATOR_NAME = process.env.INITIATOR_NAME || 'rskinitiator';
const INITIATOR_PORT = process.env.INITIATOR_PORT || 30055;
const INITIATOR_URL = `http://${INITIATOR_HOST}:${INITIATOR_PORT}/initiator`;

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
					incoming_accesskey VARCHAR(32),
					incoming_secret VARCHAR(64)
				);
				CREATE TABLE subscriptions (
					id SERIAL PRIMARY KEY,
					address VARCHAR(42),
					job VARCHAR(32)
				);
			`;
			await db.query(sqlCreate);
			console.log('[INFO] - Database tables created successfully, registering Initiator with Chainlink Node...');
			await install();
			console.log('[INFO] - Initiator registered successfully!');
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
		const newInit = await chainlink.createInitiator(process.env.INITIATOR_NAME, INITIATOR_URL);
		if (!newInit.errors){
			try {
				console.log(`[INFO] - Successfully created ${process.env.INITIATOR_NAME} initiator`);
				//console.log(newInit.data.attributes);
				const sqlInsert = `
					INSERT INTO auth_data (incoming_accesskey, incoming_secret)
					VALUES ('${newInit.data.attributes.incomingAccessKey}', '${newInit.data.attributes.incomingSecret}');
				`;
				const result = await db.query(sqlInsert);
				console.log('[INFO] - Auth config successfully saved');
				resolve(true);
			}catch(e){
				console.log(e);
			}
		}else{
			console.log(JSON.stringify(newInit.errors));
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
