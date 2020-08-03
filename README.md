# Chainlink-RSK Integration MVP

This repository contains an MVP boilerplate for testing the integration of Chainlink Oracle services with RSK blockchain network.
The objective is to provide external data to a Consumer contract deployed on RSK network through the Chainlink Oracle system,
using a simple and natural way to join both services thanks to the help of an external initiator and external adapter. A test runner
is included to setup the environment and test the complete data flow, which will be:

`Consumer contract => Oracle contract => RSK Initiator => Chainlink => RSK TX Adapter => Oracle contract => Consumer contract`

## Services:

This boilerplate has 7 services, each running in its own Docker container

- `chainlink-node`, a Chainlink node connected to an Eth dev network, using the develop Docker image.
- `postgres-server`, a PostgreSQL server for the Chainlink node, RSK Initiator and RSKTX Adapter databases.
- `ethereum-node`, an Ethereum geth node for the Chainlink node to connect to.
- `rsk-node`, a single RSK node configured to work on regtest network (private development network), using latest Docker image.
- `rsk-initiator`, an external initiator connected to the RSK node that reads the event log from an Oracle contract and invokes a job run. A new
run created by the RSK Initiator is automatically given the parameters needed for the RSK TX adapter task to report the run
back to the contract that originally created the event log, just like the native Runlog initiator.
- `rsktx-adapter`, an external adapter connected to the RSK node that takes the input given and places it into the data field of a transaction,
just like the native EthTx adapter. It then signs the transaction and sends it to an address on RSK network.
- `test-runner`, a node script that initializes the testing environment, first deploying a SideToken contract and an Oracle contract. It then configures
the Chainlink node, creating the initiator and adapter bridges and a job that includes them. Once the Chainlink node is ready, it deploys
a Consumer contract configured with the previously deployed SideToken and Oracle contracts, and the previously created job. Then mints
tokens and sends some to the Consumer contract. Finally it calls the requestRIFPrice of the Consumer contract and then polls it for
current price.

## Contracts:

- `Oracle`, the Oracle contract is the 0.5 version, with a single modification on the onTokenTransfer function of the LinkTokenReceiver to be able
to work with the SideToken.
- `SideToken`, is the contract that will be created through the RSK Token Bridge, mirroring the LinkToken contract deployed on Ethereum network.
- `Consumer`, is the contract that will request the data to the Oracle. On test run, it will request last traded price of RIF/BTC pair from Liquid.com exchange.

## Install

[Install Docker](https://docs.docker.com/get-docker/)

## Run Local Development Setup

To start the services and the test runner, simply run:

```bash
docker-compose up
```
Docker will download the required images, build the containers and start services. The test runner should start automatically.

To stop the containers and delete the volumes, so that the configuration and chain resets:

```bash
docker-compose down -v
```

## Connect your Chainlink node to RSK Testnet

Provided you have a functioning Chainlink node, and are interested in trying the RSK Initiator and RSKTX Adapters to interact with RSK Network, you can follow these instructions to get started.

### Prerequisites.

You'll need to create a Postgres database for the Initiator and another for the Adapter. You can quickly set this up with the psql cli utility:

```bash
psql -U postgres -c "create database rsk_initiator"
psql -U postgres -c "create database rsktx_adapter"
```

### 1. Clone the repository and enter project directory

```bash
git clone https://github.com/smartcontractkit/chainlink-RSK.git && cd chainlink-RSK
```

### 2. Configure the Initiator and Adapter

Create an .env-testnet file for each service and set the configuration environment variables.

#### RSK Initiator

| Key | Description | Example |
|-----|-------------|---------|
| `CHAINLINK_BASE_URL` | The URL of the Chainlink Core service with a trailing slash | `http://localhost:6688/` |
| `DATABASE_URL` | The URL of the Postgres connection | `postgresql://user:passw@host:5432/dbname` |
| `INITIATOR_HOST` | The hostname of the RSK Initiator | `localhost` |
| `INITIATOR_NAME` | The Initiator name that will be registered on Chainlink Core | `rskinitiator` |
| `INITIATOR_PORT` | The port where the Initiator service will be listening | `30055` |
| `RSK_HOST` | The hostname of the RSK Node RPC | `localhost` |
| `RSK_WS_PROTOCOL` | The protocol that will be used to connect to the RSK Node RPC (ws or wss) | `ws` |
| `RSK_WS_PORT` | The port to connect to the RSK Node RPC websocket | `4445` |
| `RSK_WS_URL` | The RSK Node RPC websocket endpoint URL | `/websocket` |

#### RSKTX Adapter

| Key | Description | Example |
|-----|-------------|---------|
| `ADAPTER_HOST` | The hostname of the RSKTX Adapter | `localhost` |
| `ADAPTER_NAME` | The Adapter name that will be registered on Chainlink Core | `rsktxadapter` |
| `ADAPTER_PORT` | The port where the Adapter service will be listening | `30056` |
| `CHAINLINK_BASE_URL` | The URL of the Chainlink Core service with a trailing slash | `http://localhost:6688/` |
| `DATABASE_URL` | The URL of the Postgres connection | `postgresql://user:passw@host:5432/dbname` |
| `RSK_HOST` | The hostname of the RSK Node RPC | `localhost` |
| `RSK_WS_PROTOCOL` | The protocol that will be used to connect to the RSK Node RPC (ws or wss) | `ws` |
| `RSK_WS_PORT` | The port to connect to the RSK Node RPC websocket | `4445` |
| `RSK_WS_URL` | The RSK Node RPC websocket endpoint URL | `/websocket` |

### 3. Configure Chainlink API credentials

Create an .api file that will contain the auth credentials of your Chainlink node. The API e-mail should be in the first line, and the API password in the second line. Example:

```
admin@example.com
changethis
```

### 4. Configure RSKTX Adapter account

The RSKTX Adapter needs an account to sign and send the transactions to the network. To configure the account, save its private key in a file and reference it later when running the adapter. This account will need to have RBTC to pay por the transactions sent to the network. Testnet RBTC can be obtained through the RSK Testnet Faucet in https://faucet.rsk.co.

### 5. Build the RSK Initiator and RSKTX Adapter Docker images 

```bash
docker build -t rsk-initiator-testnet -f ./rsk-initiator/Dockerfile.testnet .
docker build -t rsktx-adapter-testnet -f ./rsktx-adapter/Dockerfile.testnet .
```

### 6. Run the services

You can run the services containers in several ways. For the purpose of this quick guide, we'll use the docker run command. Be sure to pass the api credentials and make them available through the .api file in the destination paths /home/rsk-initiator/src/.api for the initiator, and /home/rsktx-adapter/src/.api for the adapter. You need to do the same with the .adapterKey file when runnning the RSKTX Adapter, also you need to load the environment variables from the .env-testnet file. In the example, optionally, a port parameter is added to map the service port to localhost.

```bash
docker run -v /path/to/host/api/file:/home/rsk-initiator/src/.api --env-file /path/to/initiator/.env-testnet -p 30055:30055 rsk-initiator-testnet
docker run -v /path/to/host/api/file:/home/rsktx-adapter/src/.api -v /path/to/host/adapterKey/file:/home/rsktx-adapter/src/.adapterKey --env-file /path/to/adapter/.env-testnet -p 30056:30056 rsktxk-adapter-testnet
```
The services will configure the database and register the Initiator and Adapter in Chainlink Core when first started.

### 7. Deploy the Oracle contract to RSK Testnet

You'll need to deploy an Oracle contract on RSK Testnet to be able to receive requests. In the directory testnet-deploy there are some useful scripts to accomplish this.
* Edit the truffle-config.js to configure the RSK node RPC connection.
* Configure the account that will be used to deploy the contract. To do this, save its private key on the testnet-deploy/.deployerKey file. Remember this account needs to be funded with RBTC.
* Edit the testnet-deploy/migrations/2_deploy_oracle.js and configure the ADAPTER_ADDRESS constant, setting the adapter's account address. This is needed so the migration script, after the contract deploy, can call the setFulfillmentPermission function on the contract to authorize the adapter address to fulfill Oracle's requests.
* Step into the testnet-deploy directory, install the dependencies and run the first and second migrations using Truffle:

```bash
cd testnet-deploy
npm install
npx truffle migrate --f 1 --to 2 --network rskTestnet
```

### 8. Create a test job

Now the only thing left to do is to test the request flow. First, login into the Chainlink Operator WebUI and create a new job that uses the RSK Initiator and the RSKTX Adapter. You'll need to replace RSK_INITIATOR_NAME, ORACLE_CONTRACT_ADDRESS and RSKTX_ADAPTER_NAME with your values.

```json
{
	"initiators": [
		{
			"type": "external",
			"params": {
				"name": "RSK_INITIATOR_NAME",
				"body": {
					"address": "ORACLE_CONTRACT_ADDRESS"
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
			"type": "RSKTX_ADAPTER_NAME"
		}
	]
}
```

### 9. Deploy a Consumer contract

Once the Oracle and Job are configured, the only missing piece is a client contract that requests the data. To do this:
* Edit the file testnet-deploy/migrations/3_deploy_consumer.js and configure the JOB_SPEC constant with the Job ID of the job created in the previous step.
* Make sure you are standing in the testnet-deploy directory and run the third truffle migration.

```bash
npx truffle migrate --f 3 --to 3 --network rskTestnet
```

### 10. Fund the Consumer contract

The Consumer contract will need rKovLINK to pay the Oracle. To get rKovLINK, first you'll need to get Kovan LINK and transfer them to the RSK Testnet through the RSK Token Bridge.
* Get Kovan LINK through the Kovan LINK faucet: https://kovan.chain.link/
* Convert the Kovan LINKs to rKovLINKs using the RSK Token Bridge: https://tokenbridge.rsk.co/
* Send some rKovLINKs to the Consumer Contract address.

### 11. Request data

To trigger a job request, there's a Truffle script that can be run to quickly send a test request. Standing on testnet-deploy directory:

```bash
npx truffle exec scripts/consumer-request.js --network rskTestnet
```

## Add your Chainlink node to the RIF/BTC Price Reference Aggregator running on RSK Testnet

### Configure a job in Chainlink to get RIF/USD price from Liquid.com

Login to the Chainlink Operator WebUI and add the following job. Replace RSK_INITIATOR_NAME, ORACLE_CONTRACT_ADDRESS and RSKTX_ADAPTER_NAME with your values. For the purpose of adding the node to the testnet Reference Aggregator, configure the tasks to fetch last traded price of RIF/BTC pair on Liquid.com exchange. Once this step is ready, provide the JobID and Oracle contract address to the Aggregator owners to be included.

```json
{
	"initiators": [
		{
			"type": "external",
			"params": {
				"name": "RSK_INITIATOR_NAME",
				"body": {
					"address": "ORACLE_CONTRACT_ADDRESS"
				}
			}
		}
	],
	"tasks": [
		{
			"type": "httpget",
			"params": {
				"get": "https://api.liquid.com/products/580"
			}
		},
		{
			"type": "jsonparse",
			"params": {
				"path": "last_traded_price"
			}
		},
		{
			"type": "multiply",
			"params": {
				"times": 100000000
			}
		},
		{
			"type": "ethuint256"
		},
		{
			"type": "RSKTX_ADAPTER_NAME"
		}
	]
}
```
