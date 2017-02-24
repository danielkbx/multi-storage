'use strict';

const _ = require('underscore');
const printf = require('util').format;
const async = require('async');
const URL = require('url');
const uuid = require('node-uuid');
const PassThrough = require('stream').PassThrough;

let hrBytes = function(bytes, decimals) {
	if (bytes < (1024 * 0.5)) {
		// just bytes
		return bytes + ' B';
	} else if (bytes < 1024 * 1024) {
		// kilobytes
		return Number(bytes / 1024).toFixed(decimals || 0) + ' KB';
	} else if (bytes < 1024 * 1024 * 1024) {
		// megabytes
		return Number(bytes / 1024 / 1024).toFixed(decimals || 1) + ' MB';
	}

	return Number(bytes / 1024 / 1024 / 1024).toFixed(decimals || 2) + ' GB';
};

class MultiStorage {

	constructor(options) {
		this._providers = [];
		this._logCallback = null;

		this.logPrefix = 'storage: ';

		options = options || {};

		if (_.isFunction(options.log)) {
			this._logCallback = options.log;
		}

		if (options.providers) {
			this.addProvider(options.providers);
		}
	}

	addProvider(providers) {
		if (!providers) {
			return;
		}

		if (!_.isArray(providers)) {
			providers = [providers];
		}

		let that = this;

		// sort out the providers that do not match our "interface"
		let conformingProviders = providers.filter((candidate) => {
			if (_.isUndefined(candidate.name)) {
				this._error('Provider does not conform to expected interface missing name property');
				return false;
			}
			if (_.isUndefined(candidate.schemes)) {
				this._error('Provider does not conform to expected interface missing name property');
				return false;
			}
			if (!_.isFunction(candidate.getStream)) {
				this._error('Provider %s does not conform to expected interface missing getStream function', candidate.name);
				return false;
			}
			if (!_.isFunction(candidate.postStream)) {
				this._error('Provider %s does not conform to expected interface missing postStream function', candidate.name);
				return false;
			}
			if (!_.isFunction(candidate.delete)) {
				this._error('Provider %s does not conform to expected interface missing delete function', candidate.name);
				return false;
			}
			return true;
		});
		// assign this instance to every provider's manager and assign a priority
		conformingProviders.forEach((provider) => {
			provider.manager = this;
			if (!provider.priority) {
				provider.priority = this._providers.length + 1;
			}
			that._info(printf('Using storage provider "%s" with priority %d for schemes %s'), provider.name, provider.priority, provider.schemes.join(','));
			this._providers.push(provider);
		});

		// sort the providers by priority
		this._providers.sort((a, b) => {
			return b.priority - a.priority;
		});
	}

	get providers() {
		return this._providers;
	}

	_log(level, message) {
		if (this._logCallback) {
			if (_.isString(this.logPrefix)) {
				message = this.logPrefix + message;
			}
			this._logCallback(level, message);
		}
	}

	_debug(message) {
		let text = printf.apply(this, arguments);
		this._log(MultiStorage.logLevel.debug, text);
	}

	_info(message) {
		let text = printf.apply(this, arguments);
		this._log(MultiStorage.logLevel.info, text);
	}

	_warn(message) {
		let text = printf.apply(this, arguments);
		this._log(MultiStorage.logLevel.warn, text);
	}

	_error(message) {
		let text = printf.apply(this, arguments);
		this._log(MultiStorage.logLevel.error, text);
	}

	getProvidersSupportingScheme(scheme) {
		scheme = scheme.toUpperCase();
		let providers = this._providers.filter((candidate) => {
			let supportedSchemes = candidate.schemes.map(scheme => scheme.toUpperCase());
			return (supportedSchemes.indexOf(scheme) !== -1);
		});
		return providers;
	}

	/**
	 * Determines the provider to be used for a given URL. If multiple providers match the scheme of the URL, the provider
	 * with the highest priority is used.
	 * @param {string} url
	 * @returns {Promise}
	 */
	getProviderForUrl(url) {
		let that = this;

		let parsedUrl = URL.parse(url);
		if (!parsedUrl) {
			// return early when the URL is invalid
			let err = new Error(printf('Invalid URL "%s"', url));
			that._error(err.message);
			return Promise.reject(err);
		}

		let scheme = parsedUrl.protocol;
		if (!scheme || scheme.length < 2) {
			// return early when the scheme is invalid
			let err = new Error(printf('Invalid scheme in URL "%s"', url));
			that._error(err.message);
			return Promise.reject(err);
		}

		scheme = scheme.substring(0, parsedUrl.protocol.length - 1); // remove the :
		let providersWithScheme = that.getProvidersSupportingScheme(scheme);
		if (providersWithScheme.length === 0) {
			// return early when no provider for this scheme is known
			let err = new Error(printf('No provider found for URL "%s"', url));
			that._error(err.message);
			return Promise.reject(err);
		}

		// finally, call the callback with the first available provider
		return Promise.resolve(providersWithScheme[0]);
	}

	/**
	 * Returns a promise that resolves with the data of the given URL.
	 *
	 * @param {string} url The url you received when posting the data.
	 * @param {string} encoding The encoding used for the data, defaults to utf-8
	 */
	get(url, encoding) {
		let that = this;

		if (!_.isString(encoding) || encoding.length === 0) {
			encoding = 'utf-8';
		}

		return this.getProviderForUrl(url)
			.then((provider) => {
				if (_.isFunction(provider.get)) {
					return provider.get(url, encoding);
				} else {
					return new Promise((resolve, reject) => {
						let data = null;
						that.getStream(url)
						.then((stream) => {
							stream.on('error', err => reject(err));
							stream.on('data', (chunk) => {
								if (_.isNull(data)) {
									data = chunk;
								} else {
									data += chunk;
								}
							});
							stream.on('end', () => {
								if (encoding.toLowerCase() !== 'binary') {
									data = data.toString(encoding);
								}
								resolve(data);
							});
						})
						.catch(err => reject(err));
					});
				}
			});
	}

	/**
	 * Returns a promise that is resolved with the stream for the given URL.
	 *
	 * @param {string} url The url you received when posting the data.
	 * @returns {Promise}
	 */
	getStream(url) {
		let  that = this;

		return new Promise((resolve, reject) => {
			let provider = null;
			that.getProviderForUrl(url)
				.then((foundProvider) => {
					provider = foundProvider;
					return provider.getStream(url);
				})
				.then((stream) => {
					// when we have the stream we attach our promise handlers
					// first the error
					stream.on('error', reject);
					// then the bytes counter
					let bytes = 0;
					stream.on('data', chunk => bytes += chunk.length);
					stream.on('end', () => {
						that._debug('getStream from provider %s ended with %s bytes of data', provider.name, hrBytes(bytes, 1));
					});

					stream.promisePipe = function(targetStream) {
						return new Promise((resolve, reject) => {
							stream.on('error', reject);
							stream.on('end', () => {resolve(bytes)});
							stream.pipe(targetStream);
						});
					};
					resolve(stream);
				})
				.catch(err => reject(err));
		});
	}

	optionsForOptions(options) {
		options = _.extend({
			encoding: 'utf-8',
			path: ''
		}, options);

		if (!options.name) {
			options.name = uuid.v4();
		} else if (options.name.indexOf('%') !== -1) {
			options.name = options.name.replace('%', uuid.v4());
		}

		return options;
	}

	/**
	 * Returns a promise that resolves when the data has been written.
	 * @param {*} data The data to save.
	 * @param {Object} options
	 * @param {string} options.encoding The encoding of the data, defaults to utf-8.
	 * @param (string} options.name The name of the file. Defaults to an UUID string.
	 * @param {string} options.path The path of the file, used for grouping and hierarchical structures.
	 */
	post(data, options) {
		let that = this;

		if (!_.isObject(options)) {
			options = {};
		}
		options = that.optionsForOptions(options);

		let providerPromises = this.providers.map((provider) => {
			if (_.isFunction(provider.post)) {
				return provider.post(data, options);
			} else {
				return provider.postStream(options)
					.then((stream) => {
						return new Promise((resolve, reject) => {
							stream.on('finish', () => resolve(stream));
							stream.on('error', (err) => reject(err));
							stream.end(data);
						});
					})
					.then((stream) => stream.url);
			}
		});
		return Promise.all(providerPromises);
	}

	postStream(options) {
		let that = this;
		options = that.optionsForOptions(options);

		that._debug('postStream "%s"', options.name);

		let providerPostPromises = this.providers.map(provider => provider.postStream(options));
		let outputStreams = [];

		let inputStream = new PassThrough(); // this is the stream we expose to the caller
		inputStream.urls = []; // attach the urls array so the caller gets the information
		inputStream.bytes = 0;
		inputStream.on('data', chunk => inputStream.bytes += chunk.length);

		return new Promise((resolve, reject) => {
			Promise.all(providerPostPromises)
				.then((providerStreams) => {
					let providers = that.providers;
					if (providerStreams.length !== providers.length) {
						reject(new Error('One of the providers did not provide a stream for "%s"', options.name));
						return;
					}
					// attach the provider to the stream so we have a handle to it
					for (var i = 0; i < providerStreams.length; i++) {
						providerStreams[i]._provider = providers[i];
					}

					// attach the waitForFinish promise
					let waitForFinishResolve = null;
					let waitForFinishReject = null;
					inputStream.waitForFinish = function() {
						return new Promise((finishResolve, finishReject) => {
							waitForFinishResolve = finishResolve;
							waitForFinishReject = finishReject;
						});
					};

					// attach the event handlers for the input streams
					inputStream.on('finish', () => {
						that._debug('Finished postStream "%s" with %d bytes of data', options.name, inputStream.bytes);
					});
					inputStream.on('end', () => {
						that._debug('Ended postStream "%s", unwinding pipes', options.name);
						outputStreams.forEach(outputStream => inputStream.unpipe(outputStream));
						if (waitForFinishResolve) {
							waitForFinishResolve(inputStream);
						}
					});
					inputStream.on('error', (err) => {
						that._debug('postStream (inputStream) for "%s" received error: %s', options.name, err.message)
						if (waitForFinishReject) {
							waitForFinishReject(err);
						}
					});

					// take every provider stream and …
					outputStreams = providerStreams;
					outputStreams.forEach((outputStream) => {

						// … pipe the providers stream as destination to our input stream
						if (!_.isString(outputStream.url) || outputStream.url.length < 4) {
							reject(new Error(printf('Provider "%s" did not provide an URL for "%s"', outputStream._provider.name, options.name)));
						}
						inputStream.pipe(outputStream);
						// … collect the url
						inputStream.urls.push(outputStream.url);

						// … attach the error handler
						outputStream.on('error', reject);
						// … add the size information
						outputStream.bytes = 0;
						outputStream.on('data', chunk => outputStream.bytes += chunk.length);
						// … add the end/finish handler
						outputStream.on('finish', () => {
							that._debug('Provider "%s" wrote %d bytes for "%s"', outputStream._provider.name, outputStream.bytes, options.name);
						});
						outputStream.on('close', () => {
							that._debug('Provider "%s" closed stream for "%s"', outputStream._provider.name, options.name);
						});
						outputStream.on('error', (err) => {
							that._debug('Provider %s" for "%s" received error: %s', outputStream._provider.name, options.name, err.message);
							if (waitForFinishReject) {
								waitForFinishReject(err);
							}
						});
						that._debug('Piping input stream to output stream of provider for "%s"', options.name);
					});

					resolve(inputStream);
				})
				.catch(err => reject(err));
		});
	}

	/**
	 * Returns a promise that resolves when the file for the url has been deleted.
	 * @param {string} url The url you received when posting the data.
	 */
	delete(url) {
		return this.getProviderForUrl(url).then(provider => provider.delete(url));
	}

}

MultiStorage.logLevel = {
	debug: 'debug',
	info: 'info',
	warn: 'warn',
	error: 'error'
};

MultiStorage.humanReadableBytes = hrBytes;
module.exports = MultiStorage;