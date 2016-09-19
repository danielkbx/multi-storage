'use strict';

module.exports = function (grunt, options) {
	return {
		options: {
			jshintrc: true
		},
		cli: {
			options: {
				reporter: require('jshint-stylish')
			},
			src: ['*.js', '**/*.js', '!node_modules/**/*']
		},
		build: {
			options: {
				reporter: require('jshint-jenkins-checkstyle-reporter'),
				reporterOutput: 'report-jshint-checkstyle.xml'
			},
			src: ['*.js', '**/*.js', '!node_modules/**/*']
		}
	};
};