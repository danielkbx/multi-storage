'use strict';

module.exports = function (grunt, options) {
	return {
		tasks: {},
		options: {
			filter: 'exclude',
			tasks: ['availabletasks', 'default']
		}
	};
};