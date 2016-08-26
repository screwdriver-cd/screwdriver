'use strict';

const getRoute = require('./get');
const listRoute = require('./list');
const updateRoute = require('./update');
const createRoute = require('./create');
const streamLogsRoute = require('./stream');
const stepGetRoute = require('./steps/get');
const stepUpdateRoute = require('./steps/update');
const stepLogsRoute = require('./steps/logs');

/**
 * Build API Plugin
 * @method register
 * @param  {Hapi}     server                Hapi Server
 * @param  {Object}   options               Configuration
 * @param  {Function} next                  Function to call when done
 */
exports.register = (server, options, next) => {
    server.route([
        listRoute(),
        getRoute(),
        streamLogsRoute(),
        updateRoute(),
        createRoute(options),
        // Steps
        stepGetRoute(),
        stepUpdateRoute(),
        stepLogsRoute()
    ]);

    next();
};

exports.register.attributes = {
    name: 'builds',
    dependencies: [
        'login'
    ]
};
