'use strict';

const createRoute = require('./create');
const updateRoute = require('./update');
const removeRoute = require('./remove');
const syncRoute = require('./sync');
const syncWebhooksRoute = require('./syncWebhooks');
const syncPRsRoute = require('./syncPRs');
const getRoute = require('./get');
const listRoute = require('./list');
const badgeRoute = require('./badge');
const listJobsRoute = require('./listJobs');
const listSecretsRoute = require('./listSecrets');
const listEventsRoute = require('./listEvents');
const startAllRoute = require('./startAll');

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
        removeRoute(),
        updateRoute(),
        syncRoute(),
        syncWebhooksRoute(),
        syncPRsRoute(),
        getRoute(),
        listRoute(),
        badgeRoute(),
        listJobsRoute(),
        listSecretsRoute(),
        listEventsRoute(),
        startAllRoute()
    ]);

    next();
};

exports.register.attributes = {
    name: 'pipelines'
};
