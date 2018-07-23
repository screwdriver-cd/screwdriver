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

    /**
     * Identifies userDisplayName and Screwdriver admin status of user
     * @method screwdriverAdminDetails
     * @param  {String}        username   Username of the person
     * @param  {String}        scmContext Scm to which the person logged in belongs
     * @return {Object}                   Details including the display name and admin status of user
     */
    server.expose('screwdriverAdminDetails', (username, scmContext) => {
        // construct object with defaults to store details
        const adminDetails = {
            isAdmin: false
        };

        if (scmContext) {
            const scm = server.root.app.pipelineFactory.scm;
            const scmDisplayName = scm.getDisplayName({ scmContext });
            const adminsList = options.admins;

            // construct displayable username string
            adminDetails.userDisplayName = `${scmDisplayName}:${username}`;

            // Check system configuration for list of system admins
            // set admin status true if current user is identified to be a system admin
            if (adminsList.length > 0
                && adminsList.includes(adminDetails.userDisplayName)) {
                adminDetails.isAdmin = true;
            }
        }

        // return details
        return adminDetails;
    });

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
        removeAllTokens()
    ]);

    next();
};

exports.register.attributes = {
    name: 'pipelines'
};
