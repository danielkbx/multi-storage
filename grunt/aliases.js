'use strict';

module.exports = {
	default: ['availabletasks'],
	check: {
		description: 'Checks the syntax of all Javascript files and runs the tests',
		tasks: [ 'jshint:cli', 'mochaTest:cli' ]
	},
	'check-build': {
		description: 'Checks the syntax of all Javascript files and runs the tests (build environment)',
		tasks: [ 'jshint:build', 'mochaTest:build' ]
	}
};