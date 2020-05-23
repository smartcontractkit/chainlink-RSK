FROM node:11.15.0

RUN mkdir -p /home/rsk-initiator/src/node_modules
RUN mkdir -p /home/chainlink-api-client/src

COPY ./rsk-initiator/src/package*.json /home/rsk-initiator/src/
COPY ./chainlink-api-client/package*.json /home/chainlink-api-client/

RUN chown -R node:node /home/

USER node

WORKDIR /home/rsk-initiator/src

RUN mkdir /home/rsk-initiator/config

RUN npm install 2>&1 \
    && mv /home/rsk-initiator/src/node_modules /home/rsk-initiator/
RUN rm /home/rsk-initiator/node_modules/chainlink-api-client
RUN ln -s /home/chainlink-api-client/src /home/rsk-initiator/node_modules/chainlink-api-client

COPY --chown=node:node . .

ENTRYPOINT ["npm"]
CMD ["run", "dev"]