// The external.js file contains the definitions for the creation of
// the initiator, adapter and job to be used during test run

const INITIATOR_NAME = 'rskinitiator';
const INITIATOR_URL = 'http://rsk-initiator:30055/initiator';

const ADAPTER_NAME = 'rsktxadapter';
const ADAPTER_URL = 'http://rsktx-adapter:30056/adapter';

const JOB_SPEC = {
	"initiators": [
		{
			"type": "external",
			"params": {
				"name": INITIATOR_NAME,
				"body": {
					"address": ""
				}
			}
		}
	],
	"tasks": [
		{
			"type": "httpget"
		},
		{
			"type": "jsonparse"
		},
		{
			"type": "multiply"
		},
		{
			"type": "ethuint256"
		},
		{
			"type": ADAPTER_NAME
		}
	]
}

module.exports = {
	INITIATOR_NAME,
	INITIATOR_URL,
	ADAPTER_NAME,
	ADAPTER_URL,
	JOB_SPEC
};
