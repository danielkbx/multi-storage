'use strict';

/*jshint -W030 */

var expect = require('chai').expect;
var _ = require('underscore');
var fs = require('fs');
var path = require('path');
var Readable = require('stream').Readable;
var Writable = require('stream').Writable;

var MultiStorage = require('../');

let isPromise = function(candidate) {
	if (!_.isObject(candidate)) {
		return false;
	}

	if (!_.isFunction(candidate.then)) {
		return false;
	}

	if (!_.isFunction(candidate.catch)) {
		return false;
	}

	return true;
};

class InMemoryStringWriteStream extends Writable {
	constructor() {
		super();
		this.receivedData = null;
		this.errorOnWrite = false;
	}

	_write(chunk, encoding, callback) {
		if (this.errorOnWrite) {
			return callback('error', new Error('the error'));
		}
		if (!this.receivedData) {
			this.receivedData = '';
		}
		this.receivedData += chunk;

		callback();
	}
}

class InMemoryStringReadStream extends Readable {
	constructor(string) {
		super();
		this._data = string;
		this._didRead = false;
		this.errorOnRead = false;
	}

	_read(size) {
		let that = this;

		if (!that._didRead) {
			that._didRead = true;
			if (that.errorOnRead) {
				that.emit('error', new Error('The error'));
				that.push(null);
			} else {
				setTimeout(() => {

					that.push(this._data);
					that.push(null);

				}, 10);
			}
		}
	}
}

class CompactProvider {
	constructor() {
		this.didCallGetStream = false;
		this.didCallPostStream = false;
		this.didCallDelete = false;
		this.returnErrorOnGetStream = false;
		this.callWithErrorOnGetStream = false;
		this.returnErrorOnPostStream = false;
		this.callWithErrorOnPostStream = false;
		this.returnErrorOnDelete = false;
		this.errorOnPostStreamWrite = false;
		this.receivedOptions = {};

		this.postStreamReceivedData = null;
	}

	get name() {return 'CompactMockProvider'}
	get schemes() {return ['compact']}

	getStream(url) {
		this.didCallGetStream = true;
		if (this.returnErrorOnGetStream) {
			return Promise.reject(new Error('Some error'));
		} else {
			let stream = new InMemoryStringReadStream('Some data');
			if (this.callWithErrorOnGetStream) {
				setTimeout(() => {
					stream.emit('error', new Error('Reading failure'));
				}, 10);
			}
			return Promise.resolve(stream);
		}
	}


	postStream(stream) {
		let that = this;

		this.didCallPostStream = true;
		let callWithError = this.callWithErrorOnPostStream;
		if (this.returnErrorOnPostStream) {
			return Promise.reject(new Error('Some error'));
		} else {
			let stream = new InMemoryStringWriteStream();
			stream.errorOnWrite = this.errorOnPostStreamWrite;
			stream.url = this.schemes[0] +  '://someIdentifier';

			this.postStreamReceivedData = null;
			stream.on('finish', () => that.postStreamReceivedData = stream.receivedData);
			return Promise.resolve(stream);
		}
	}
	delete(url) {
		this.didCallDelete = true;
		if (this.returnErrorOnDelete) {
			return Promise.reject(new Error('Some error'));
		} else {
			return Promise.resolve();
		}
	}
}

class Provider extends CompactProvider {

	constructor() {
		super();
		this.didCallGet = false;
		this.didCallPost = false;
		this.returnErrorOnGet = false;
		this.returnErrorOnPost = false;

		this.postReceivedData = null;
	}

	get name() {return 'MockProvider'}
	get schemes() {return ['mock']}

	get(url, encoding) {
		this.didCallGet = true;
		if (this.returnErrorOnGet) {
			return Promise.reject(new Error('Some error'));
		} else {
			return Promise.resolve('some data to return');
		}
	}

	post(data, options) {
		this.didCallPost = true;
		this.receivedOptions = options;
		this.postReceivedData = data;
		if (this.returnErrorOnPost) {
			return Promise.reject(new Error('Some error'));
		} else {
			return Promise.resolve(this.schemes[0] +  '://someIdentifier');
		}
	}
}

describe('Operations', () => {

	describe('get', () => {

		it('calls the providers get function', (done) => {
			// given
			let provider = new Provider();
			let storage = new MultiStorage({providers: [provider]});

			// when
			storage.get('mock://something')
				.then(() => {
					// then
					expect(provider.didCallGet).to.be.true;
					done();
				})
				.catch(err => done(err));
		});

		it('returns the data of the provider', (done) => {
			// given
			let provider = new Provider();
			let storage = new MultiStorage({providers: [provider]});

			// when
			storage.get('mock://something')
				.then((data) => {
					// then
					expect(data.length).to.be.gt(0);
					done();
				})
				.catch(err => done(err));
		});

		it('rejects with the error provided by the provider', (done) => {
			// given
			let provider = new Provider();
			provider.returnErrorOnGet = true;
			let storage = new MultiStorage({providers: [provider]});

			// when
			storage.get('mock://something')
				.then(() => {
					// then
					done(new Error('Expected the get call to return the error'));
				})
				.catch(err => done());
		});

		it('uses the getStream method if provider has no get method', (done) => {
			// given
			let provider = new CompactProvider();
			let storage = new MultiStorage({providers: [provider]});

			// when
			storage.get('compact://something')
				.then((string) => {
					// then
					expect(_.isString(string)).to.be.true;
					expect(provider.didCallGetStream).to.be.true;
					expect(string.length).to.be.gt(0);
					done();
				})
				.catch(err => done(err));
		});

		it('returns the binary data of the getStream method', (done) => {
			// given
			let provider = new CompactProvider();
			let storage = new MultiStorage({providers: [provider]});

			// when
			storage.get('compact://something', 'binary')
				.then((data) => {
					// then
					expect(Buffer.prototype.isPrototypeOf(data)).to.be.true;
					expect(provider.didCallGetStream).to.be.true;
					expect(data.length).to.be.gt(0);
					done();
				})
				.catch(err => done(err));
		});
	});

	describe('getStream', () => {

		it('calls the providers getStream function', (done) => {
			// given
			let provider = new Provider();
			let storage = new MultiStorage({providers: [provider]});
			let writeStream = new InMemoryStringWriteStream();

			// when
			storage.getStream('mock://something')
				.then(stream => stream.promisePipe(writeStream))
				.then((bytes) => {
					if (!provider.didCallGetStream) {
						return done(new Error('Expected getStream called on the provider but this did not happen'));
					}
					let receivedData = writeStream.receivedData;
					expect(receivedData).to.equal('Some data');
					expect(bytes).to.equal('Some data'.length);
					done();
				})
				.catch(err => done(err));
		});

		it('rejects when the provider cannot provide a stream', (done) => {
			// when the provider returns an error during stream creation we receive no stream and the callback is called

			// given
			let provider = new Provider();
			provider.returnErrorOnGetStream = true;
			let storage = new MultiStorage({providers: [provider]});

			// when
			storage.getStream('mock://something')
				.then(stream => done(new Error('Expected the getStream call to return the error')))
				.catch(err => done());
		});

		it('rejects when the piped stream emits an error', (done) => {
			// given
			let provider = new Provider();
			provider.callWithErrorOnGetStream = true;
			let storage = new MultiStorage({providers: [provider]});
			let writeStream = new InMemoryStringWriteStream();

			// when
			storage.getStream('mock://something')
				.then(stream => stream.getPipe(writeStream))
				.then(() => done(new Error('Expected getStream callback to pass an error')))
				.catch(err => done());
		});

	});

	describe('post', () => {

		it('passes the options to the provider', (done) => {
			// given
			let provider = new Provider();
			let storage = new MultiStorage({providers: [provider]});
			let options = {name: 'name', path: 'path', encoding: 'encoding'};

			// when
			storage.post('data', options)
				.then(() => {
					// then
					expect(provider.receivedOptions).to.be.ok;
					expect(provider.receivedOptions.name).to.equal('name');
					expect(provider.receivedOptions.path).to.equal('path');
					expect(provider.receivedOptions.encoding).to.equal('encoding');
					done();
				})
				.catch(err => done(err));
		});

		it('uses default values if the options passed are not complete', (done) => {
			// given
			let provider = new Provider();
			let storage = new MultiStorage({providers: [provider]});
			let options = {name: 'name', path: 'path'};

			// when
			storage.post('data', options)
				.then(() => {
					// then
					expect(provider.receivedOptions).to.be.ok;
					expect(provider.receivedOptions.name).to.equal('name');
					expect(provider.receivedOptions.path).to.equal('path');
					expect(provider.receivedOptions.encoding).to.equal('utf-8');
					done();
				})
				.catch(err => done(err));
		});

		it('uses default values if no options are passed', (done) => {
			// given
			let provider = new Provider();
			let storage = new MultiStorage({providers: [provider]});

			// when
			storage.post('data')
				.then(() => {
					// then
					expect(provider.receivedOptions).to.be.ok;
					expect(provider.receivedOptions.name.length).to.be.gt(10);
					expect(provider.receivedOptions.path).to.equal('');
					expect(provider.receivedOptions.encoding).to.equal('utf-8');
					done();
				})
				.catch(err => done(err));
		});

		it('calls the providers post function', (done) => {
			// given
			let provider1 = new Provider();
			let provider2 = new Provider();
			let storage = new MultiStorage({providers: [provider1, provider2]});

			// when
			storage.post('some data')
				.then((urls) => {
					// then
					expect(provider1.didCallPost).to.be.true;
					expect(provider2.didCallPost).to.be.true;
					expect(urls.length).to.equal(2);
					expect(urls[0].startsWith('mock://')).to.equal(true);
					expect(urls[1].startsWith('mock://')).to.equal(true);
					expect(provider1.postReceivedData).to.equal('some data');
					expect(provider2.postReceivedData).to.equal('some data');
					done();
				})
				.catch(err => done(err));
		});

		it('includes the error of the providers post function callback', (done) => {
			// given
			let provider = new Provider();
			provider.returnErrorOnPost = true;
			let storage = new MultiStorage({providers: [provider]});

			// when
			storage.post('some data')
				.then(() => {
					// then
					done(new Error('Expected the post call to return the error'));
				})
				.catch(err => done());
		});

		it('uses the postStream method if provider has no post method', (done) => {
			// given
			let provider1 = new CompactProvider();
			let provider2 = new Provider();
			let storage = new MultiStorage({providers: [provider1, provider2]});

			// when
			storage.post('some data')
				.then((urls) => {
					// then
					expect(provider1.didCallPostStream).to.be.true;
					expect(urls.length).to.equal(2);
					expect(urls[0].startsWith('mock://')).to.equal(true);
					expect(urls[1].startsWith('compact://')).to.equal(true);
					expect(provider1.postStreamReceivedData).to.equal('some data');
					expect(provider2.postReceivedData).to.equal('some data');
					done();
				})
				.catch(err => done(err));
		});
	});

	describe('postStream', () => {
		it('calls the providers postStream function', (done) => {
			// given
			let provider1 = new Provider();
			let provider2 = new Provider();
			let storage = new MultiStorage({providers: [provider1, provider2]});

			// when
			storage.postStream()
				.then((stream) => {
					if (!provider1.didCallPostStream || !provider2.didCallPostStream) {
						return done(new Error('Expected postStream called on the provider but this did not happen'));
					}

					expect(stream).to.be.ok;
					let urls = stream.urls;
					expect(urls.length).to.equal(2);
					expect(urls[0].startsWith('mock://')).to.equal(true);
					expect(urls[1].startsWith('mock://')).to.equal(true);

					done();
				})
				.catch(err => done(err));
		});

		it('rejects with the error of the providers postStream promise', (done) => {
			// given
			let provider = new Provider();
			provider.returnErrorOnPostStream = true;
			let storage = new MultiStorage({providers: [provider]});

			// when
			storage.postStream()
				.then(stream => done(new Error('Expected the postStream call to return the error')))
				.catch(err => done());
		});

		it('passes all data to the providers', (done) => {
			// given
			let provider1 = new Provider();
			let provider2 = new Provider();
			let storage = new MultiStorage({providers: [provider1, provider2]});

			let data1 = '';
			let data2 = '';
			// we override the postStream method so we can collect the data the stream receives
			provider1._postStream = provider1.postStream;
			provider1.postStream = function(options) {
				return this._postStream(options)
					.then((stream) => {
						stream.on('finish', () => {
							data1 = stream.receivedData;
						});
						return Promise.resolve(stream);
					});
			};
			provider2._postStream = provider2.postStream;
			provider2.postStream = function(options) {
				return this._postStream(options)
					.then((stream) => {
						stream.on('finish', () => {
							data2 = stream.receivedData;
						});
						return Promise.resolve(stream);
					});
			};
			let sourceStream = new InMemoryStringReadStream('some test data');


			// when
			storage.postStream()
				.then((stream) => {
					sourceStream.pipe(stream);
					return stream.waitForFinish();
				})
				.then((stream) => {
					expect(stream.urls.length).to.equal(2);
					expect(data1).to.equal('some test data');
					expect(data2).to.equal('some test data');
					expect(stream.bytes).to.equal('some test data'.length);
					done();
				})
				.catch(err => done(err));
		});

		it('rejects the waitForFinish promise when the provider emits an error', (done) => {
			// given
			let provider1 = new Provider();
			let storage = new MultiStorage({providers: [provider1]});
			let sourceStream = new InMemoryStringReadStream('some test data');
			provider1.errorOnPostStreamWrite = true;

			// when
			storage.postStream()
				.then((stream) => {
					sourceStream.pipe(stream);
					return stream.waitForFinish();
				})
				.then(stream => done(new Error('Expecting an error')))
				.catch(err => done());
		});

	});

	describe('delete', () => {

		it('calls the providers delete function', (done) => {
			// given
			let provider = new Provider();
			let storage = new MultiStorage({providers: [provider]});

			// when
			storage.delete('mock:something')
				.then(() => {
					if (!provider.didCallDelete) {
						return done(new Error('Expected delete called on the provider but this did not happen'));
					}
					done();
				})
				.catch(err => done(err));
		});

		it('returns the error of the providers delete function', (done) => {
			// given
			let provider = new Provider();
			provider.returnErrorOnDelete = true;
			let storage = new MultiStorage({providers: [provider]});

			// when
			storage.delete('mock.something')
				.then(() => {
					return done(new Error('Expected the delete call to return the error'));
				})
				.catch(err => done());
		});

	});

});
