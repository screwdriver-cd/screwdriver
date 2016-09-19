'use strict';
const createRoute = require('./create');
const getRoute = require('./get');
const listRoute = require('./list');
const updateRoute = require('./update');
const badgeRoute = require('./badge');
const listJobsRoute = require('./listJobs');
const listSecretsRoute = require('./listSecrets');

/**
 * Pipeline API Plugin
 * @method register
 * @param  {Hapi}     server            Hapi Server
 * @param  {Object}   options           Configuration
 * @param  {Function} next              Function to call when done
 */
exports.register = (server, options, next) => {
    server.route([
        createRoute(),
        getRoute(),
        listRoute(),
        updateRoute(),
        badgeRoute(),
        listJobsRoute(),
        listSecretsRoute()
    ]);

    next();
};

exports.register.attributes = {
    name: 'pipelines'
};
