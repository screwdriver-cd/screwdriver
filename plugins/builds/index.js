'use strict';

const getRoute = require('./get');
const listRoute = require('./list');
const updateRoute = require('./update');
const createRoute = require('./create');
const streamLogsRoute = require('./stream');

/**
 * Build API Plugin
 * @method register
 * @param  {Hapi}     server            Hapi Server
 * @param  {Object}   options           Configuration
 * @param  {Object}   options.datastore Datastore object
 * @param  {Object}   options.executor  Executor object
 * @param  {Function} next              Function to call when done
 */
exports.register = (server, options, next) => {
    server.route([
        listRoute(options.datastore, options.executor),
        getRoute(options.datastore, options.executor),
        streamLogsRoute(options.datastore, options.executor),
        updateRoute(options.datastore, options.executor),
        createRoute(options.datastore, options.executor)
    ]);

    next();
};

exports.register.attributes = {
    name: 'builds'
};
