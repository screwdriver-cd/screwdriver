'use strict';
const createRoute = require('./create');
const getRoute = require('./get');
const listRoute = require('./list');
const updateRoute = require('./update');

/**
 * Pipeline API Plugin
 * @method register
 * @param  {Hapi}     server            Hapi Server
 * @param  {Object}   options           Configuration
 * @param  {Object}   options.datastore Datastore Model
 * @param  {Function} next              Function to call when done
 */
exports.register = (server, options, next) => {
    server.route([
        createRoute(options.datastore),
        getRoute(options.datastore),
        listRoute(options.datastore),
        updateRoute(options.datastore)
    ]);

    next();
};

exports.register.attributes = {
    name: 'pipelines'
};
