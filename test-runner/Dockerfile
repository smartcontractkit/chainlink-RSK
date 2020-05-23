FROM node:11.15.0

RUN mkdir -p /home/test-runner/src/node_modules
RUN mkdir -p /home/chainlink-api-client/src

COPY ./test-runner/src/package*.json /home/test-runner/src/
COPY ./chainlink-api-client/package*.json /home/chainlink-api-client/

RUN chown -R node:node /home/

USER node

WORKDIR /home/test-runner/src

RUN mkdir /home/test-runner/artifacts
RUN mkdir /home/test-runner/config

RUN npm install 2>&1 \
    && mv /home/test-runner/src/node_modules /home/test-runner
RUN rm /home/test-runner/node_modules/chainlink-api-client
RUN ln -s /home/chainlink-api-client/src /home/test-runner/node_modules/chainlink-api-client

COPY --chown=node:node . .

ENTRYPOINT ["npm"]
CMD ["run", "dev"]