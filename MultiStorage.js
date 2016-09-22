'use strict';

let _ = require('underscore');
let printf = require('util').format;
let Callback = require('node-callback');
let async = require('async');
let URL = require('url');
let uuid = require('node-uuid');
let PassThrough = require('stream').PassThrough;

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
			if (!_.isFunction(candidate.get)) {
				this._error('Provider %s does not conform to expected interface missing get function', candidate.name);
				return false;
			}
			if (!_.isFunction(candidate.getStream)) {
				this._error('Provider %s does not conform to expected interface missing getStream function', candidate.name);
				return false;
			}
			if (!_.isFunction(candidate.post)) {
				this._error('Provider %s does not conform to expected interface missing post function', candidate.name);
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
	 * @param {MultiStorageGetProviderForURLCallback} callback
	 */
	getProviderForUrl(url, callback) {
		let cb = new Callback(arguments);
		let that = this;

		let parsedUrl = URL.parse(url);
		if (!parsedUrl) {
			// return early when the URL is invalid
			let err = new Error(printf('Invalid URL "%s"', url));
			that._error(err.message);
			cb.call(err);
			return err;
		}

		let scheme = parsedUrl.protocol;
		if (!scheme || scheme.length < 2) {
			// return early when the scheme is invalid
			let err = new Error(printf('Invalid scheme in URL "%s"', url));
			that._error(err.message);
			cb.call(err);
			return err;
		}

		scheme = scheme.substring(0, parsedUrl.protocol.length - 1); // remove the :
		let providersWithScheme = that.getProvidersSupportingScheme(scheme);
		if (providersWithScheme.length === 0) {
			// return early when no provider for this scheme is known
			let err = new Error(printf('No provider found for URL "%s"', url));
			that._error(err.message);
			cb.call(err);
			return err;
		}

		// finally, call the callback with the first available provider
		cb.call(null, providersWithScheme[0]);
		return providersWithScheme[0];
	}

	/**
	 * Returns the data of the file at the given url. If no encoding is given 'utf-8' is used.
	 *
	 * @param {string} path
	 * @param {string} encoding
	 * @param {MultiStorageGetCallback} callback
	 */
	get(url, encoding, callback) {
		let that = this;
		let cb = new Callback(arguments);

		if (_.isFunction(encoding) && !callback) {
			encoding = 'utf-8';
		}

		async.waterfall([
			function getProvider(doneW) {
				that.getProviderForUrl(url, doneW);
			},
			function callProvider(provider, doneW) {
				provider.get(url, encoding, doneW);
			}
		], function(err, result) {
			if (err) {
				that._error(err.message);
			}
			cb.call(err, result);
		});
	}

	getStream(url, callback) {
		let cb = new Callback(arguments);

		let provider = this.getProviderForUrl(url);
		if (Error.prototype.isPrototypeOf(provider)) {
			let err = provider;
			cb.call(err);
			return null;
		}

		let stream = provider.getStream(url);
		if (Error.prototype.isPrototypeOf(stream)) {
			let err = stream;
			cb.call(err);
			return null;
		}

		let didCallCallback = false;
		stream.on('error', (err) => {
			if (!didCallCallback) {
				didCallCallback = true;
				cb.call(err);
			}
		});
		stream.on('end', () => {
			if (!didCallCallback) {
				didCallCallback = true;
				cb.call();
			}
		});

		return stream;
	}

	post(data, options, callback) {
		let that = this;
		let cb = new Callback(arguments);

		if (_.isFunction(options) && !callback) {
			options = {};
		}

		options = _.extend({
			encoding: 'utf-8',
			name: uuid.v4(),
			path: ''
		}, options);

		let urls = [];
		async.each(this.providers, (provider, doneE) => {
			provider.post(data, options, (err, url) => {
				if (url) {
					urls.push(url);
				}
				doneE(err);
			});
		}, (err) => {
			if (err) {
				that._error(err.message);
			}
			cb.call(err, urls);
		});
	}

	/**
	 * Creates and returns a stream for every provider. These streams are returned immediately while the
	 * callback is called when all streams have been closed.
	 * @param options
	 * @param callback
	 * @returns {[Stream]}
	 */
	postStream(options, callback) {
		let that = this;
		let cb = new Callback(arguments);

		options = _.extend({
			encoding: 'utf-8',
			name: uuid.v4(),
			path: ''
		}, options);

		that._debug('postStream "%s"', options.name);

		// collect the information about each handle (which is the provider's stream, error and url)
		let handlers = [];

		let handleProviderCallsBack = function() {

			let unfinishedHandlers = handlers.filter(candidate => _.isNull(candidate.error) && _.isNull(candidate.url));
			let finishedHandlers = handlers.filter(candidate => !_.isNull(candidate.error) || !_.isNull(candidate.url));
			if (unfinishedHandlers.length === 0 && finishedHandlers.length > 0) {
				let successfulHandlers = handlers.filter(candidate => !_.isNull(candidate.url));
				let failedHandlers = handlers.filter(candidate => !_.isNull(candidate.error));

				let urls = successfulHandlers.map(handler => handler.url);
				let errors = failedHandlers.map(handler => handler.error);

				let err = null;
				if (errors.length > 0) {
					err = new Error('Failed to save stream, see underlying errors');
					err.underlyingErrors = errors;
				}
				cb.call(err, urls);
			}
		};

		let createProviderFunctionCallCallback = function(handler) {
			return function(err, url) {
				if (handler.stream) {
					handler.error = err;
					handler.url = url;
					handleProviderCallsBack();
				}
			};
		};

		for (let i = 0; i < this.providers.length; i++) {
			let provider = this.providers[i];

			let handler = {stream: null, url: null, error: null, name: provider.name};
			handlers.push(handler);
			let stream = provider.postStream(options, createProviderFunctionCallCallback(handler));

			// if one of the providers returns an error or null we abort
			if (!stream || Error.prototype.isPrototypeOf(stream)) {
				that._warn('Provider %s could not provide a writeable stream', provider.name);
				let err = Error.prototype.isPrototypeOf(stream) ? stream : new Error(printf('Failed to create stream for provider %s', provider.name));
				// get rid of all the things we already have
				handlers = [];
				// and exit here
				cb.call(err, null);
				return null;
			} else {
				that._debug('Provider %s provided writeable stream', provider.name);
				handler.stream = stream;
			}
		}

		let stream = new PassThrough();
		let receivedBytes = 0;
		stream.on('data', (chunk) => {
			receivedBytes += chunk.length;
		});

		stream.on('end', () => {
			that._debug('Post stream ended');
		});
		stream.on('finish', () => {
			that._debug('Post stream finished posting %s, unwinding pipes', hrBytes(receivedBytes));
			handlers.forEach((providerStream) => {
				stream.unpipe(providerStream);
			});
		});

		stream.on('error', (err) => {
			that._warn('Post stream received error: %s', err.message);
		});

		handlers.forEach((handler) => {
			stream.pipe(handler.stream);
			that._debug('Piping post stream to writeable stream of provider %s', handler.name);

			handler.stream.on('error', (err) => {
				that._debug('Stream of provider %s had an error: %s', handler.name, err.message);
			});

			handler.stream.on('close', () => {
				that._debug('Stream of provider %s closed', handler.name);
			});
		});

		return stream;
	}

	delete(url, callback) {
		let that = this;
		let cb = new Callback(arguments);

		async.waterfall([
			function getProvider(doneW) {
				that.getProviderForUrl(url, doneW);
			},
			function callProvider(provider, doneW) {
				provider.delete(url, doneW);
			}
		], function(err, result) {
			if (err) {
				that._error(err.message);
			}
			cb.call(err, result);
		});
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

/**
 * @callback MultiStorageGetProviderForURLCallback
 * @param {Error} err
 * @param {MultiStorageProvider} provider
 */

/**
 * @callback MultiStorageGetCallback
 * @param {Error} err
 * @param data
 */