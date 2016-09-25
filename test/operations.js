'use strict';

/*jshint -W030 */

var expect = require('chai').expect;
var _ = require('underscore');
var fs = require('fs');
var path = require('path');
var Readable = require('stream').Readable;
var Writable = require('stream').Writable;

var MultiStorage = require('../');

class InMemoryStringWriteStream extends Writable {
	constructor() {
		super();
		this.receivedData = null;
	}

	_write(chunk, encoding, callback) {
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
	}

	_read(size) {
		let that = this;

		if (!that._didRead) {
			that._didRead = true;
			setTimeout(() => {
				this.push(this._data);
				that.push(null);
			}, 10);
		}
	}
}

class Provider {
	constructor() {
		this.didCallGet = false;
		this.didCallGetStream = false;
		this.didCallPost = false;
		this.didCallPostStream = false;
		this.didCallDelete = false;
		this.returnErrorOnGet = false;
		this.returnErrorOnGetStream = false;
		this.callWithErrorOnGetStream = false;
		this.returnErrorOnPost = false;
		this.returnErrorOnPostStream = false;
		this.callWithErrorOnPostStream = false;
		this.returnErrorOnDelete = false;
		this.receivedOptions = {};
	}
	get name() {return 'MockProvider'}
	get schemes() {return ['mock']}
	get(url, encoding, callback) {
		this.didCallGet = true;
		if (this.returnErrorOnGet) {
			return callback(new Error('Some error'), null);
		} else {
			return callback(null, 'some data to return');
		}
	}
	getStream(url) {
		this.didCallGetStream = true;
		if (this.returnErrorOnGetStream) {
			return new Error('Some error');
		} else {
			let stream = new InMemoryStringReadStream('Some data');
			if (this.callWithErrorOnGetStream) {
				setTimeout(() => {
					stream.emit('error', new Error('Reading failure'));
				}, 10);
			}
			return stream;
		}
	}

	post(data, options, callback) {
		this.didCallPost = true;
		this.receivedOptions = options;
		if (this.returnErrorOnPost) {
			return callback(new Error('Some error'), null);
		} else {
			return callback(null, 'mock://someIdentifier');
		}
	}
	postStream(stream, callback) {
		this.didCallPostStream = true;
		let callWithError = this.callWithErrorOnPostStream;
		if (this.returnErrorOnPostStream) {
			return new Error('Some error');
		} else {
			let stream = new InMemoryStringWriteStream();
			setTimeout(() => {
				if (callWithError) {
					callback(new Error('Some error'), null);
				} else {
					callback(null, 'mock://someIdentifier');
				}
			}, 10);
			return stream;
		}
	}
	delete(url, callback) {
		this.didCallDelete = true;
		if (this.returnErrorOnDelete) {
			return callback(new Error('Some error'), null);
		} else {
			return callback(null);
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
			storage.get('mock://something', (err, data) => {
				// then
				if (!provider.didCallGet) {
					return done(new Error('Expected get called on the provider but this did not happen'));
				}
				done(err);
			});
		});

		it('returns the data of the providers get function', (done) => {
			// given
			let provider = new Provider();
			let storage = new MultiStorage({providers: [provider]});

			// when
			storage.get('mock://something', (err, data) => {
				// then
				if (data.length === 0) {
					return done(new Error('Expected the get call to return the data'));
				}
				done(err);
			});
		});

		it('includes the error of the providers get function callback', (done) => {
			// given
			let provider = new Provider();
			provider.returnErrorOnGet = true;
			let storage = new MultiStorage({providers: [provider]});

			// when
			storage.get('mock://something', (err, data) => {
				// then
				if (!err) {
					return done(new Error('Expected the get call to return the error'));
				}
				done(null);
			});
		});

	});

	describe('getStream', () => {

		it('calls the providers getStream function', (done) => {
			// given
			let provider = new Provider();
			let storage = new MultiStorage({providers: [provider]});
			let writeStream = new InMemoryStringWriteStream();

			// when
			let stream = storage.getStream('mock://something', (err, bytes) => {
				// then
				if (!provider.didCallGetStream) {
					return done(new Error('Expected getStream called on the provider but this did not happen'));
				}
				let receivedData = writeStream.receivedData;
				expect(receivedData).to.equal('Some data');
				expect(bytes).to.equal('Some data'.length);
				done(err);
			});

			expect(stream).to.be.ok;
			stream.pipe(writeStream);
		});

		it('returns the error of the providers getStream function callback', (done) => {
			// when the provider returns an error during stream creation we receive no stream and the callback is called

			// given
			let provider = new Provider();
			provider.returnErrorOnGetStream = true;
			let storage = new MultiStorage({providers: [provider]});

			// when
			let stream = storage.getStream('mock://something', (err) => {
				// then
				if (!err) {
					done(new Error('Expected the getStream call to return the error'));
				} else {
					done();
				}
			});
			expect(stream).not.to.be.ok;
		});

		it('includes the providers error in getStream callback', (done) => {
			// given
			let provider = new Provider();
			provider.callWithErrorOnGetStream = true;
			let storage = new MultiStorage({providers: [provider]});
			let writeStream = new InMemoryStringWriteStream();

			// when
			let stream = storage.getStream('mock://something', (err) => {
				// then
				if (!err) {
					return done(new Error('Expected getStream callback to pass an error'));
				}
				done();
			});

			expect(stream).to.be.ok;
			stream.pipe(writeStream);
		});

	});

	describe('post', () => {

		it('passes the options to the provider', (done) => {
			// given
			let provider = new Provider();
			let storage = new MultiStorage({providers: [provider]});
			let options = {name: 'name', path: 'path', encoding: 'encoding'};

			// when
			storage.post('data', options, (err, urls) => {
				// then
				expect(provider.receivedOptions).to.be.ok;
				expect(provider.receivedOptions.name).to.equal('name');
				expect(provider.receivedOptions.path).to.equal('path');
				expect(provider.receivedOptions.encoding).to.equal('encoding');
				done(err);
			});
		});

		it('uses default values if the options passed are not complete', (done) => {
			// given
			let provider = new Provider();
			let storage = new MultiStorage({providers: [provider]});
			let options = {name: 'name', path: 'path'};

			// when
			storage.post('data', options, (err, urls) => {
				// then
				expect(provider.receivedOptions).to.be.ok;
				expect(provider.receivedOptions.name).to.equal('name');
				expect(provider.receivedOptions.path).to.equal('path');
				expect(provider.receivedOptions.encoding).to.equal('utf-8');
				done(err);
			});
		});

		it('uses default values if no options are passed', (done) => {
			// given
			let provider = new Provider();
			let storage = new MultiStorage({providers: [provider]});

			// when
			storage.post('data', (err, urls) => {
				// then
				expect(provider.receivedOptions).to.be.ok;
				expect(provider.receivedOptions.name.length).to.be.gt(10);
				expect(provider.receivedOptions.path).to.equal('');
				expect(provider.receivedOptions.encoding).to.equal('utf-8');
				done(err);
			});
		});

		it('calls the providers post function', (done) => {
			// given
			let provider1 = new Provider();
			let provider2 = new Provider();
			let storage = new MultiStorage({providers: [provider1, provider2]});

			// when
			storage.post('some data', (err, urls, bytes) => {
				// then
				if (!provider1.didCallPost || !provider2.didCallPost) {
					return done(new Error('Expected post called on the provider but this did not happen'));
				}
				expect(urls.length).to.equal(2);
				expect(urls[0].startsWith('mock://')).to.equal(true);
				expect(urls[1].startsWith('mock://')).to.equal(true);
				expect(bytes).to.equal('some data'.length);
				done(err);
			});
		});

		it('includes the error of the providers post function callback', (done) => {
			// given
			let provider = new Provider();
			provider.returnErrorOnPost = true;
			let storage = new MultiStorage({providers: [provider]});

			// when
			storage.post('some data', (err, urls) => {
				// then
				if (!err) {
					return done(new Error('Expected the post call to return the error'));
				}
				done(null);
			});
		});
	});

	describe('postStream', () => {
		it('calls the providers postStream function', (done) => {
			// given
			let provider1 = new Provider();
			let provider2 = new Provider();
			let storage = new MultiStorage({providers: [provider1, provider2]});

			// when
			let streams = storage.postStream((err, urls) => {
				// then
				if (!provider1.didCallPostStream || !provider2.didCallPostStream) {
					return done(new Error('Expected postStream called on the provider but this did not happen'));
				}
				expect(urls.length).to.equal(2);
				expect(urls[0].startsWith('mock://')).to.equal(true);
				expect(urls[1].startsWith('mock://')).to.equal(true);
				done(err);
			});
			expect(streams).to.be.ok;

		});

		it('includes the error of the providers postStream function callback', (done) => {
			// given
			let provider = new Provider();
			provider.returnErrorOnPostStream = true;
			let storage = new MultiStorage({providers: [provider]});

			// when
			let stream = storage.postStream((err, urls) => {
				// then
				if (!err) {
					return done(new Error('Expected the postStream call to return the error'));
				}
				done(null);
			});
			expect(stream).not.to.be.ok;
		});

		it('includes the error of the providers postStream function callback when stream creation failed', (done) => {
			// given
			let provider = new Provider();
			provider.callWithErrorOnPostStream = true;
			let storage = new MultiStorage({providers: [provider]});

			// when
			let stream = storage.postStream((err, urls) => {
				// then
				if (!err) {
					return done(new Error('Expected the postStream call to return the error'));
				}
				done(null);
			});
			expect(stream).to.be.ok;
		});

		it('passes all data to the providers', (done) => {
			// given
			let provider1 = new Provider();
			let provider2 = new Provider();
			let storage = new MultiStorage({providers: [provider1, provider2]});

			let data1 = '';
			let data2 = '';
			// we override the postStream method so we can collect the data the stream recieve
			provider1.postStream = function(options, callback) {
				let stream = new InMemoryStringWriteStream();
				stream.on('finish', () => {
					data1 = stream.receivedData;
					callback(null, 'inmemory://test');
				});
				return stream;
			};
			provider2.postStream = function(options, callback) {
				let stream = new InMemoryStringWriteStream();
				stream.on('finish', () => {
					data2 = stream.receivedData;
					callback(null, 'inmemory://test');
				});
				return stream;
			};

			// when
			let stream = storage.postStream((err, urls, bytes) => {
				// then
				expect(urls.length).to.equal(2);
				expect(data1).to.equal('some test data');
				expect(data2).to.equal('some test data');
				expect(bytes).to.equal('some test data'.length);
				done(err);
			});

			// we write a little text into the stream after a little while
			setTimeout(() => {
				stream.write('some test data');
				stream.end();
			}, 10);

		});

	});

	describe('delete', () => {

		it('calls the providers delete function', (done) => {
			// given
			let provider = new Provider();
			let storage = new MultiStorage({providers: [provider]});

			// when
			storage.delete('mock://something', (err) => {
				// then
				if (!provider.didCallDelete) {
					return done(new Error('Expected delete called on the provider but this did not happen'));
				}
				done(err);
			});
		});

		it('returns the error of the providers delete function', (done) => {
			// given
			let provider = new Provider();
			provider.returnErrorOnDelete = true;
			let storage = new MultiStorage({providers: [provider]});

			// when
			storage.delete('mock://something', (err) => {
				// then
				if (!err) {
					return done(new Error('Expected the delete call to return the error'));
				}
				done(null);
			});
		});

	});

});
