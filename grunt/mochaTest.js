'use strict';

module.exports = function (grunt, options) {
	let testSources = ['test/**/*.js'];
	return {
		cli: {
			src: testSources,
			options: {
				reporter: 'spec',
				quiet: false
			}
		},
		build: {
			src: testSources,
			options: {
				reporter: 'xunit',
				captureFile: 'report-mocha-test.xml',
				quiet: true
			}
		}
	};
};