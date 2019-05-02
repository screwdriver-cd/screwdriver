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
const jobBadgeRoute = require('./jobBadge');
const listJobsRoute = require('./listJobs');
const listTriggersRoute = require('./listTriggers');
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
    const statusColor = {
        unknown: 'lightgrey',
        disabled: 'lightgrey',
        created: 'lightgrey',
        success: 'green',
        queued: 'blue',
        blocked: 'blue',
        running: 'blue',
        collapsed: 'lightgrey',
        frozen: 'lightgrey',
        unstable: 'yellow',
        failure: 'red',
        aborted: 'red'
    };

    /**
     * Returns an encoded string of subject based on separator of the badge service
     * @method encodeBadgeSubject
     * @param  {String} badgeService           badge service url
     * @param  {String} subject                subject to put in the badge
     * @return {String} encodedSubject
     */
    server.expose('encodeBadgeSubject', ({ badgeService, subject }) => {
        const separator = badgeService.match(/}}(.){{/)[1];

        if (separator === '/') {
            return encodeURIComponent(subject);
        }

        // Reference: https://shields.io/
        if (separator === '-') {
            return subject.replace(/-/g, '--').replace(/_/g, '__');
        }

        return subject;
    });

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
        badgeRoute({ statusColor }),
        jobBadgeRoute({ statusColor }),
        listJobsRoute(),
        listTriggersRoute(),
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
