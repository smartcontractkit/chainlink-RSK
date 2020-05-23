#!/bin/sh
# chainlink-launcher.sh
# Initialization script for the Chainlink Node.

set -e

DB_HOST="$1"
DEPLOY_HOST="$2"
keyimport="$3"
startnode="$4"


>&2 echo "Waiting for Postgres to be ready..."

# Wait for PostgreSQL to be up and accepting connections
until PGPASSWORD=$POSTGRES_PASSWORD psql -h "$DB_HOST" -U "postgres" -c '\q'; do
  >&2 echo "Postgres is unavailable yet - trying again in 5 sec"
  sleep 5
done

>&2 echo "Postgres is up!"

# import keystore from the keystore.json file
>&2 echo "Importing keystore..."
$keyimport

# set the LinkToken address received from Deployer REST API and start chainlink node
>&2 echo "Running node..."
LINK_CONTRACT_ADDRESS=$HTTP_BODY exec $startnode