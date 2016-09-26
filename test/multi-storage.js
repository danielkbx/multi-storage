'use strict';

/*jshint -W030 */

var expect = require('chai').expect;
var _ = require('underscore');

var MultiStorage = require('../');

describe('MultiStorage', () => {

	describe('Tools', () => {

		describe('humanReadableBytes', () => {

			it('returns the correct bytes', () => {
				expect(MultiStorage.humanReadableBytes(5)).to.equal('5 B');
			});

			it('returns the correct unrounded bytes', () => {
				expect(MultiStorage.humanReadableBytes(500)).to.equal('500 B');
			});

			it('returns the correct rounded kilobytes', () => {
				expect(MultiStorage.humanReadableBytes(1023)).to.equal('1 KB');
			});

			it('returns the correct kilobytes', () => {
				expect(MultiStorage.humanReadableBytes(5000)).to.equal('5 KB');
			});

			it('returns the correct megabytes', () => {
				expect(MultiStorage.humanReadableBytes(5000000)).to.equal('4.8 MB');
			});

			it('returns the correct gigabytes', () => {
				expect(MultiStorage.humanReadableBytes(5000000000)).to.equal('4.66 GB');
			});
		});

	});

	describe('Options', () => {

		it('creates the default options', () => {
			// given
			let storage = new MultiStorage();
			let options = {};

			// when
			options = storage.optionsForOptions(options);

			// then
			expect(options.encoding).to.equal('utf-8');
			expect(options.name.length).to.be.gt(5);
			expect(options.path).to.equal('');
		});

		it('keeps the existing settings', () => {
			// given
			let storage = new MultiStorage();
			let options = {name: 'name.txt', path: 'path/subpath', encoding: 'utf-16'};

			// when
			options = storage.optionsForOptions(options);

			// then
			expect(options.encoding).to.equal('utf-16');
			expect(options.name).to.equal('name.txt');
			expect(options.path).to.equal('path/subpath');
		});

		it('composes an unique name but keeps the extension', () => {
			// given
			let storage = new MultiStorage();
			let options = {name: '%.txt'};

			// when
			options = storage.optionsForOptions(options);

			// then
			expect(options.name.length).to.be.gt(6);
			expect(options.name.endsWith('.txt')).to.be.true;
		});

		it('composes an unique name but keeps the extension and fixed parts if present', () => {
			// given
			let storage = new MultiStorage();
			let options = {name: 'base-%.txt'};

			// when
			options = storage.optionsForOptions(options);

			// then
			expect(options.name.length).to.be.gt(10);
			expect(options.name.endsWith('.txt')).to.be.true;
			expect(options.name.startsWith('base-')).to.be.true;
		});

	});

	// --- Providers Tests ---------------------------------------------------------------------------------------------

	describe('Providers', () => {

		class Provider {
			constructor() {
				this._schemes = ['mock'];
			}
			get name() {return 'MockProvider'}
			get schemes() { return this._schemes}
			get() {}
			getStream() {}
			post() {}
			postStream() {}
			delete() {}
		}

		it('should accept providers conforming to the interface', () => {
			// given
			let provider = new Provider();

			// when
			var storage = new MultiStorage({
				providers: [provider]
			});

			// then
			expect(storage.providers.length).to.equal(1);
			let firstProvider = storage.providers[0];
			expect(firstProvider).to.be.equal(provider);
		});

		it('should not accept providers not conforming to the interface', () => {
			// given
			let provider = {
				get: function () {},
				getStream: function () {},
				post: function () {},
				postStream: function () {},
				// we skip the delete function here
			};

			// when
			var storage = new MultiStorage({
				providers: [provider]
			});

			// then
			expect(storage.providers.length).to.equal(0);
		});

		it('assigns itself as manager to providers', () => {
			// given
			let provider = new Provider();

			// when
			var storage = new MultiStorage({
				providers: [provider]
			});

			// then
			let firstProvider = storage.providers[0];
			expect(firstProvider.manager).to.equal(storage);
		});

		it('adds a new provider correctly', () => {
			// given
			let storage = new MultiStorage();
			let provider = new Provider();

			// when
			storage.addProvider(provider);

			// then
			expect(storage.providers.length).to.equal(1);
			let firstProvider = storage.providers[0];
			expect(firstProvider).to.equal(provider);
			expect(firstProvider.manager).to.equal(storage);
		});

		it('sorts the providers according their priorities', () => {
			// given
			let provider1 = new Provider();
			provider1.priority = 10;
			let provider2 = new Provider();
			provider2.priority = 13;

			// when
			let storage = new MultiStorage({providers: [provider1, provider2]});

			// then
			expect(provider1.priority).to.be.gt(0);
			expect(provider2.priority).to.be.gt(0);
			expect(provider2.priority).to.be.gt(provider1.priority);
		});


		it('automatically applies a priority', () => {
			// given
			let provider1 = new Provider();
			let provider2 = new Provider();

			// when
			let storage = new MultiStorage({providers: [provider1, provider2]});

			// then
			expect(provider1.priority).to.be.gt(0);
			expect(provider2.priority).to.be.gt(0);
			// the one that has been added later has the higher priority
			expect(provider2.priority).to.be.gt(provider1.priority);
		});

		it('should return the providers supporting a scheme', () => {
			// given
			let providerHTTP = new Provider();
			providerHTTP._schemes = ['HTTP', 'HTTPS', 'SSH'];
			providerHTTP.priority = 10;
			let providerFTP = new Provider();
			providerFTP._schemes = ['FTP', 'FTPS', 'ssh'];
			providerFTP.priority = 1;

			// when
			let storage = new MultiStorage({providers: [providerHTTP, providerFTP]});

			// then
			expect(storage.getProvidersSupportingScheme('http')[0]).to.equal(providerHTTP);
			expect(storage.getProvidersSupportingScheme('httpS')[0]).to.equal(providerHTTP);
			expect(storage.getProvidersSupportingScheme('FTP')[0]).to.equal(providerFTP);
			expect(storage.getProvidersSupportingScheme('FTPs')[0]).to.equal(providerFTP);
			// requesting an unknown scheme returns an empty array
			expect(storage.getProvidersSupportingScheme('rtsp')).to.be.empty;
			// requresting a schemes that multiple providers declare, we return the providers in order of priority
			expect(storage.getProvidersSupportingScheme('ssh')[0]).to.equal(providerHTTP);
			expect(storage.getProvidersSupportingScheme('SSH')[1]).to.equal(providerFTP);
		});

		it('uses the correct provider for an url', (done) => {
			// given
			let provider1 = new Provider();
			provider1._schemes = ['scheme1'];
			let provider2 = new Provider();
			provider2._schemes = ['scheme2'];
			let storage = new MultiStorage({providers: [provider1, provider2]});

			// when
			storage.getProviderForUrl('scheme1://something', (err, providerToUse) => {
				// then
				expect(providerToUse).to.equal(provider1);
				done(err);
			});
		});
	});

	// --- Logging Tests -----------------------------------------------------------------------------------------------

	describe('Logging', () => {

		it('calls the log function with debug level', (done) => {
			// given
			let log = function (level, text) {
				expect(level).to.equal(MultiStorage.logLevel.debug);
				expect(text).to.equal('Some text');
				done();
			};

			// when
			var storage = new MultiStorage({
				log: log
			});
			storage.logPrefix = '';

			// then
			storage._debug('Some %s', 'text');
		});

		it('calls the log function with correct prefix', (done) => {
			// given
			let log = function (level, text) {
				expect(level).to.equal(MultiStorage.logLevel.debug);
				expect(text).to.equal('prefix: Some text');
				done();
			};

			// when
			var storage = new MultiStorage({
				log: log
			});
			storage.logPrefix = 'prefix: ';

			// then
			storage._debug('Some %s', 'text');
		});

		it('calls the log function with info level', (done) => {
			// given
			let log = function (level, text) {
				expect(level).to.equal(MultiStorage.logLevel.info);
				expect(text).to.equal('Some text');
				done();
			};

			// when
			var storage = new MultiStorage({
				log: log
			});
			storage.logPrefix = '';

			// then
			storage._info('Some %s', 'text');
		});

		it('calls the log function with warn level', (done) => {
			// given
			let log = function (level, text) {
				expect(level).to.equal(MultiStorage.logLevel.warn);
				expect(text).to.equal('Some text');
				done();
			};

			// when
			var storage = new MultiStorage({
				log: log
			});
			storage.logPrefix = '';

			// then
			storage._warn('Some %s', 'text');
		});

		it('calls the log function with error level', (done) => {
			// given
			let log = function (level, text) {
				expect(level).to.equal(MultiStorage.logLevel.error);
				expect(text).to.equal('Some text');
				done();
			};

			// when
			var storage = new MultiStorage({
				log: log
			});
			storage.logPrefix = '';

			// then
			storage._error('Some %s', 'text');
		});
	});
});