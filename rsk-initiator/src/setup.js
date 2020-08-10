const ChainlinkAPIClient = require('chainlink-api-client');
const fs = require('fs');
const db = require('./db.js');
const Web3 = require('web3');
require('console-stamp')(console);

const web3 = new Web3();

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
					incoming_secret VARCHAR(64),
					outgoing_token_hash VARCHAR(64),
					outgoing_secret_hash VARCHAR(64)
				);
				CREATE TABLE subscriptions (
					id SERIAL PRIMARY KEY,
					address VARCHAR(42),
					job VARCHAR(32)
				);
			`;
			await db.query(sqlCreate);
			console.info('Database tables created successfully, registering Initiator with Chainlink Node...');
			await install();
			console.info('Initiator registered successfully!');
			resolve(true);
		}catch(e){
			console.error(e);
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
				console.info(`Successfully created ${process.env.INITIATOR_NAME} initiator`);
				const outgoingTokenHash = web3.utils.sha3(newInit.data.attributes.outgoingToken).slice(2);
				const outgoingSecretHash = web3.utils.sha3(newInit.data.attributes.outgoingSecret).slice(2);
				const sqlInsert = `
					INSERT INTO auth_data (
						incoming_accesskey,
						incoming_secret,
						outgoing_token_hash,
						outgoing_secret_hash)
					VALUES (
						'${newInit.data.attributes.incomingAccessKey}',
						'${newInit.data.attributes.incomingSecret}',
						'${outgoingTokenHash}',
						'${outgoingSecretHash}'
					);
				`;
				const result = await db.query(sqlInsert);
				console.info('Auth config successfully saved');
				resolve(true);
			}catch(e){
				console.error(e);
			}
		}else{
			console.error(JSON.stringify(newInit.errors));
		}
		await chainlink.logout();		
	});
}

async function runSetup(){
	try {
		const result = await db.query('SELECT * FROM auth_data');
		if (result.fields.length == 2){
			console.info('Found old auth schema, updating...');
			const sqlUpdate = `
				ALTER TABLE auth_data
				ADD COLUMN outgoing_token_hash VARCHAR(64),
				ADD COLUMN outgoing_secret_hash VARCHAR(64);
			`;
			const result = await db.query(sqlUpdate);
			console.info('Auth schema updated successfully!');
			await install();
		}else{
			if (result.rows.length > 0){
				console.info('Authentication data found');
			}else{
				console.info('Database exists but authentication data is not found, running install...');
				await install();
			}
		}
	}catch(e){
		if (e.toString().indexOf('relation "auth_data" does not exist') > -1){
			console.info('Creating database tables...');
			await initDb();
		}else{
			console.error(e);
		}
	}
	process.exit();
}
