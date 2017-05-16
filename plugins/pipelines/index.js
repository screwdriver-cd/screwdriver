'use strict';

const createRoute = require('./create');
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
const boom = require('boom');

/**
 * Pipeline API Plugin
 * @method register
 * @param  {Hapi}     server            Hapi Server
 * @param  {Object}   options           Configuration
 * @param  {Function} next              Function to call when done
 */
exports.register = (server, options, next) => {
    server.expose('canAccess', (credentials, pipeline, permission) => {
        const userFactory = server.root.app.userFactory;
        const username = credentials.username;

        return userFactory.get({ username }).then((user) => {
            if (!user) {
                throw boom.notFound(`User ${username} does not exist`);
            }

            return user.getPermissions(pipeline.scmUri).then((permissions) => {
                if (!permissions[permission]) {
                    return false;
                }

                return true;
            });
        });
    });

    server.route([
        createRoute(),
        removeRoute(),
        syncRoute(),
        syncWebhooksRoute(),
        syncPRsRoute(),
        getRoute(),
        listRoute(),
        badgeRoute(),
        listJobsRoute(),
        listSecretsRoute(),
        listEventsRoute()
    ]);

    next();
};

exports.register.attributes = {
    name: 'pipelines'
};
