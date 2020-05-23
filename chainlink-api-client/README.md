# Chainlink API Client

A very simple class that allows communicating with a Chainlink node API in an easy way

## Usage

```js
const ChainlinkAPIClient = require('chainlink-api-client');

const chainlink = new ChainlinkAPIClient(
	email: 'admin@example.com',
	password: 'yourpassword',
	basePath: 'http://localhost:6688'
);

chainlink.login().then(() => {
	chainlink.getConfig().then(config => {
		console.log(config);
	});
});
> {
    accountAddress: ... ,
    allowOrigins: ... ,
    ethChainId: ... ,
    ...
}
```
