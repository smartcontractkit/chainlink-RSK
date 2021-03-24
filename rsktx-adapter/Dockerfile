FROM node:15.11-alpine

RUN mkdir -p /home/rsktx-adapter/src/node_modules

COPY ./src/package.json /home/rsktx-adapter/src/

RUN chown -R node:node /home/

USER node

WORKDIR /home/rsktx-adapter/src

RUN npm install 2>&1 \
    && mv /home/rsktx-adapter/src/node_modules /home/rsktx-adapter/

COPY --chown=node:node . .

ENTRYPOINT ["npm"]
CMD ["run", "dev"]
