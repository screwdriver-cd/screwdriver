'use strict';

const tokenRoute = require('./token');

/**
 * Collections API Plugin
 * @method register
 * @param  {Hapi}      server          Hapi Server
 * @param  {Object}    options         Configuration
 * @param  {Function}  next            Function to call when done
 */
exports.register = (server, options, next) => {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const CoveragePlugin = require(`screwdriver-coverage-${options.plugin}`);

    const coveragePlugin = new CoveragePlugin(options[options.plugin]);

    server.route([
        tokenRoute({ coveragePlugin })
    ]);

    next();
};

exports.register.attributes = {
    name: 'coverage'
};
