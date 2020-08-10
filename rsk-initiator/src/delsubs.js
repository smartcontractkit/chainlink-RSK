const fs = require('fs');
const db = require('./db.js');

deleteSubs();

async function deleteSubs(){
	try {
		const sqlDelete = `
			TRUNCATE TABLE subscriptions;
		`;
		await db.query(sqlDelete);
		console.log('[INFO] - Subscriptions on database have been deleted.');
	}catch(e){
		console.log(e);
	}
}