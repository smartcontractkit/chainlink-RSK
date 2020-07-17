#!/bin/sh
# chainlink-launcher.sh
# Initialization script for the Chainlink Node.

set -e

DB_HOST="$1"
keyimport="$2"
startnode="$3"

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

# start chainlink node
>&2 echo "Running node..."
exec $startnode