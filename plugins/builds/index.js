'use strict';

const getRoute = require('./get');
const listRoute = require('./list');
const updateRoute = require('./update');
const createRoute = require('./create');
const stepGetRoute = require('./steps/get');
const stepUpdateRoute = require('./steps/update');
const stepLogsRoute = require('./steps/logs');

/**
 * Build API Plugin
 * @method register
 * @param  {Hapi}     server                Hapi Server
 * @param  {Object}   options               Configuration
 * @param  {String}   options.logBaseUrl    Log service's base URL
 * @param  {Function} next                  Function to call when done
 */
exports.register = (server, options, next) => {
    server.route([
        listRoute(),
        getRoute(),
        updateRoute(),
        createRoute(),
        // Steps
        stepGetRoute(),
        stepUpdateRoute(),
        stepLogsRoute(options)
    ]);

    next();
};

exports.register.attributes = {
    name: 'builds'
};
