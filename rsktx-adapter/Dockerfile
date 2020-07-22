FROM node:11.15.0

RUN mkdir -p /home/rsktx-adapter/src/node_modules
RUN mkdir -p /home/chainlink-api-client/src

COPY ./rsktx-adapter/src/package*.json /home/rsktx-adapter/src/
COPY ./chainlink-api-client/package*.json /home/chainlink-api-client/

RUN chown -R node:node /home/

USER node

WORKDIR /home/rsktx-adapter/src

RUN npm install 2>&1 \
    && mv /home/rsktx-adapter/src/node_modules /home/rsktx-adapter/
RUN rm /home/rsktx-adapter/node_modules/chainlink-api-client
RUN ln -s /home/chainlink-api-client/src /home/rsktx-adapter/node_modules/chainlink-api-client

COPY --chown=node:node . .

ENTRYPOINT ["npm"]
CMD ["run", "dev"]
