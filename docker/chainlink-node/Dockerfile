FROM smartcontract/chainlink:develop

RUN apt-get update
RUN apt-get install -y postgresql-client curl

COPY chainlink-launcher.sh /bin/chainlink-launcher
RUN chmod +x /bin/chainlink-launcher

ENTRYPOINT ["/bin/chainlink-launcher"]
CMD ["chainlink-db", "contract-deployer", "chainlink node import /run/secrets/chainlink_key", "chainlink node start -p /run/secrets/chainlink_secret -a /run/secrets/chainlink_api"]
