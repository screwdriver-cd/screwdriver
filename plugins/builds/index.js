'use strict';

const getRoute = require('./get');
const updateRoute = require('./update');
const createRoute = require('./create');
const stepGetRoute = require('./steps/get');
const stepUpdateRoute = require('./steps/update');
const stepLogsRoute = require('./steps/logs');
const listSecretsRoute = require('./listSecrets');

/**
 * Build API Plugin
 * @method register
 * @param  {Hapi}     server                Hapi Server
 * @param  {Object}   options               Configuration
 * @param  {String}   options.logBaseUrl    Log service's base URL
 * @param  {Function} next                  Function to call when done
 */
exports.register = (server, options, next) => {
    /**
     * Create event for downstream pipeline that need to be rebuilt
     * @method triggerEvent
     * @param {Object}  config              Configuration object
     * @param {String}  config.pipelineId   Pipeline to be rebuilt
     * @param {String}  config.startFrom    Job to be rebuilt
     * @param {String}  config.username     Upstream build ID
     * @return {Object} event
     */
    server.expose('triggerEvent', (config) => {
        const { pipelineId, startFrom, username } = config;
        const eventFactory = server.root.app.eventFactory;
        const pipelineFactory = server.root.app.pipelineFactory;
        const userFactory = server.root.app.userFactory;
        const scm = eventFactory.scm;

        const payload = {
            pipelineId,
            startFrom,
            type: 'pipeline',
            username
        };

        return pipelineFactory.get(pipelineId)
            .then((pipeline) => {
                const scmUri = pipeline.scmUri;
                const admin = Object.keys(pipeline.admins)[0];
                const scmContext = pipeline.scmContext;

                // get pipeline admin's token
                return userFactory.get({ username: admin, scmContext })
                    .then(user => user.unsealToken())
                    .then((token) => {
                        const scmConfig = {
                            scmContext,
                            scmUri,
                            token
                        };

                        // Get commit sha
                        return scm.getCommitSha(scmConfig)
                            .then((sha) => {
                                payload.sha = sha;

                                return eventFactory.create(payload);
                            });
                    });
            });
    });

    server.route([
        getRoute(),
        updateRoute(),
        createRoute(),
        // Steps
        stepGetRoute(),
        stepUpdateRoute(),
        stepLogsRoute(options),
        // Secrets
        listSecretsRoute()
    ]);

    next();
};

exports.register.attributes = {
    name: 'builds'
};
