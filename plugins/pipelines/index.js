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
const createToken = require('./tokens/create');
const updateToken = require('./tokens/update');
const refreshToken = require('./tokens/refresh');
const listTokens = require('./tokens/list');
const removeToken = require('./tokens/remove');
const removeAllTokens = require('./tokens/removeAll');
const metricsRoute = require('./metrics');

/**
 * Pipeline API Plugin
 * @method register
 * @param  {Hapi}     server            Hapi Server
 * @param  {Object}   options           Configuration
 * @param  {Function} next              Function to call when done
 */
exports.register = (server, options, next) => {
    /**
     * Returns true if the scope does not include pipeline or includes pipeline
     * and it's pipelineId matches the pipeline, otherwise returns false
     * @method isValidToken
     * @param  {String} id                     ID of pipeline
     * @param  {Object} credentials            Credential object from Hapi
     * @param  {String} credentials.pipelineId ID of pipeline which the token is allowed to access
     * @param  {String} credentials.scope      Scope whose token is allowed
     */
    server.expose('isValidToken', (id, credentials) =>
        !credentials.scope.includes('pipeline') ||
                parseInt(id, 10) === parseInt(credentials.pipelineId, 10)
    );

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
        startAllRoute(),
        updateToken(),
        refreshToken(),
        createToken(),
        listTokens(),
        removeToken(),
        removeAllTokens(),
        metricsRoute()
    ]);

    next();
};

exports.register.attributes = {
    name: 'pipelines'
};
