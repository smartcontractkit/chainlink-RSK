const fetch = require("isomorphic-unfetch");

module.exports = class ChainlinkAPIClient {
	
	constructor(config) {
		this.email = config.email;
		this.password = config.password;
		this.basePath = config.basePath;
	}

	archiveJob(jobId){
		return new Promise (async (resolve, reject) => {
			this.request(`v2/specs/${jobId}`, {
				'cookies': this.cookies,
				'method': 'DELETE'
			}).then(rJson => {
				resolve(rJson);
			}).catch(e => {
				reject(e);
			});;
		});
	}

	createBridge(name, url){
		return new Promise (async (resolve, reject) => {
			this.request('v2/bridge_types/', {
				'cookies': this.cookies,
				'data': {
					'name': name,
					'url': url
				},
				'method': 'POST'
			}).then(rJson => {
				resolve(rJson);
			}).catch(e => {
				reject(e);
			});
		});
	}

	createInitiator(name, url){
		return new Promise (async (resolve, reject) => {
			this.request('v2/external_initiators/', {
				'cookies': this.cookies,
				'data': {
					'name': name,
					'url': url
				},
				'method': 'POST'
			}).then(rJson => {
				resolve(rJson);
			}).catch(e => {
				reject(e);
			});
		});
	}

	createJob(initiators, tasks){
		return new Promise (async (resolve, reject) => {
			this.request('v2/specs/', {
				'cookies': this.cookies,
				'data': {
					'initiators': initiators,
					'tasks': tasks
				},
				'method': 'POST'
			}).then(rJson => {
				resolve(rJson);
			}).catch(e => {
				reject(e);
			});
		});
	}

	deleteBridge(name){
		return new Promise (async (resolve, reject) => {
			this.request(`v2/bridge_types/${name}`, {
				'cookies': this.cookies,
				'method': 'DELETE'
			}).then(rJson => {
				resolve(rJson);
			}).catch(e => {
				reject(e);
			});;
		});
	}

	deleteInitiator(name){
		return new Promise (async (resolve, reject) => {
			this.request(`v2/external_initiators/${name}`, {
				'cookies': this.cookies,
				'method': 'DELETE'
			}).then(rJson => {
				resolve(rJson);
			}).catch(e => {
				reject(e);
			});
		});
	}

	getBridges(){
		return new Promise (async (resolve, reject) => {
			this.request('v2/bridge_types/', {
				'cookies': this.cookies,
				'method': 'GET'
			}).then(rJson => {
				resolve(rJson);
			}).catch(e => {
				reject(e);
			});
		});
	}

	getConfig() {
		return new Promise (async (resolve, reject) => {
			this.request('v2/config/', {
				'cookies': this.cookies,
				'method': 'GET'
			}).then(rJson => {
				resolve(rJson.data.attributes);
			}).catch(e => {
				reject(e);
			});
		});
	}

	getJobs() {
		return new Promise (async (resolve, reject) => {
			this.request('v2/specs/', {
				'cookies': this.cookies,
				'method': 'GET'
			}).then(rJson => {
				resolve(rJson);
			}).catch(e => {
				reject(e);
			});
		});
	}

	initiateJobRun(jobId, accessKey, secret, req) {
		return new Promise (async (resolve, reject) => {
			this.request(`v2/specs/${jobId}/runs`, {
				'data': req,
				'headers': {
					'x-chainlink-ea-accesskey': accessKey,
					'x-chainlink-ea-secret': secret
				},
				'method': 'POST'
			}).then(rJson => {
				resolve(rJson);
			}).catch(e => {
				reject(e);
			});
		});
	}

	login() {
		return new Promise (async (resolve, reject) => {
			this.request('sessions', {
				'data': {
					'email': this.email,
					'password': this.password
				},
				'method': 'POST'
			}).then(rJson => {
				if (!rJson.errors){
					if (typeof rJson.data.attributes.authenticated !== 'undefined'){
						let cookies = this.parseCookies(rJson.headers);
						this.cookies = cookies;
						resolve(cookies);
					}else{
						reject(rJson);
					}
				}else{
					resolve(rJson);
				}
			}).catch(e => {
				reject(e);
			});
		});
	}

	logout() {
		return new Promise (async (resolve, reject) => {
			this.request('sessions', {
				'cookies': this.cookies,
				'method': 'DELETE'
			}).then(rJson => {
				resolve(rJson);
			}).catch(e => {
				reject(e);
			});
		});
	}

	parseCookies(headers) {
		const raw = headers.raw()['set-cookie'];
		return raw.map((entry) => {
			const parts = entry.split(';');
			const cookiePart = parts[0];
			return cookiePart;
		}).join(';');
	}

	request(endpoint, options) {
		return new Promise (async (resolve, reject) => {
			let url = this.basePath + endpoint
			if (typeof options.headers !== 'undefined'){
				options.headers['Content-type'] = 'application/json';
			}else{
				options.headers = { 
					'Content-type': 'application/json'
				}
			}
			if (typeof options.cookies !== 'undefined'){
				options.headers["Cookie"] = options.cookies;
			}
			let config = {
				credentials: 'include',
				headers: options.headers,
				method: options.method
			}
			if ((options.method == 'POST' || options.method == 'PATCH') && typeof options.data !== 'undefined'){
				config['body'] = JSON.stringify(options.data);
			}
			fetch(url, config).then(async r => {
				if (r.status !== 204 && r.status !== 401){
					let rJson = await r.json();
					rJson.headers = r.headers;
					if (typeof rJson.data !== 'undefined' || typeof rJson.errors !== 'undefined'){
						resolve(rJson);
					}else{
						throw r.status + ' ' + r.statusText;
					}
				}else{
					if (r.status == 204){
						let rJson = {
							'headers': r.headers,
							'data': '204 No Content'
						};
						resolve(rJson);
					}else if (r.status == 401){
						let rJson = {
							'headers': r.headers,
							'errors': '401 Not Authorized'
						};
						resolve(rJson);
					}else{
						reject(r.status);
					}
				}
			}).catch(e => {
				reject(e);
			});
		});
	}

	updateJobRun(token, data) {
		return new Promise (async (resolve, reject) => {
			this.request(`v2/runs/${data.id}`, {
				'data': data,
				'headers': {
					'Authorization': token
				},
				'method': 'PATCH'
			}).then(rJson => {
				resolve(rJson);
			}).catch(e => {
				reject(e);
			});
		});
	}
}
