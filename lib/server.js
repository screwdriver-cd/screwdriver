'use strict';

const Hapi = require('@hapi/hapi');
const logger = require('screwdriver-logger');
const registerPlugins = require('./registerPlugins');

process.on('unhandledRejection', (reason, p) => {
    console.error('Unhandled Rejection at: Promise', p, 'reason:', reason); /* eslint-disable-line no-console */
});

/**
 * If we're throwing errors, let's have them say a little more than just 500
 * @method prettyPrintErrors
 * @param  {Hapi.Request}    request Hapi Request object
 * @param  {Hapi.h}     h   Hapi Response Toolkit
 */
function prettyPrintErrors(request, h) {
    const { response } = request;
    const { release } = request.server.app;

    if (release && release.cookieName && request.state && !request.state[release.cookieName]) {
        h.state(release.cookieName, release.cookieValue);
    }

    if (!response.isBoom) {
        return h.continue;
    }

    const err = response;
    const errName = err.output.payload.error;
    const errMessage = err.message;
    const { statusCode } = err.output.payload;
    const stack = err.stack || errMessage;

    if (statusCode === 500) {
        request.log(['server', 'error'], stack);
    }

    const res = {
        statusCode,
        error: errName,
        message: errMessage
    };

    if (err.data) {
        res.data = err.data;
    }

    return h.response(res).code(statusCode);
}

/**
 * Configures & starts up a HapiJS server
 * @method
 * @param  {Object}      config
 * @param  {Object}      config.httpd
 * @param  {Integer}     config.httpd.port          Port number to listen to
 * @param  {String}      config.httpd.host          Host to listen on
 * @param  {String}      config.httpd.uri           Public routable address
 * @param  {Object}      config.httpd.tls           TLS Configuration
 * @param  {Object}      config.webhooks            Webhooks settings
 * @param  {String}      config.webhooks.restrictPR Restrict PR setting
 * @param  {Boolean}     config.webhooks.chainPR    Chain PR flag
 * @param  {Object}      config.ecosystem           List of hosts in the ecosystem
 * @param  {Object}      config.ecosystem.ui        URL for the User Interface
 * @param  {Factory}     config.pipelineFactory     Pipeline Factory instance
 * @param  {Factory}     config.jobFactory          Job Factory instance
 * @param  {Factory}     config.userFactory         User Factory instance
 * @param  {Factory}     config.bannerFactory       Banner Factory instance
 * @param  {Factory}     config.buildFactory        Build Factory instance
 * @param  {Factory}     config.buildClusterFactory Build Cluster Factory instance
 * @param  {Factory}     config.stepFactory         Step Factory instance
 * @param  {Factory}     config.secretFactory       Secret Factory instance
 * @param  {Factory}     config.tokenFactory        Token Factory instance
 * @param  {Factory}     config.eventFactory        Event Factory instance
 * @param  {Factory}     config.collectionFactory   Collection Factory instance
 * @param  {Factory}     config.stageFactory        Stage Factory instance
 * @param  {Factory}     config.triggerFactory      Trigger Factory instance
 * @param  {Object}      config.builds              Config to include for builds plugin
 * @param  {Object}      config.builds.ecosystem    List of hosts in the ecosystem
 * @param  {Object}      config.builds.authConfig   Configuration for auth
 * @param  {Object}      config.builds.externalJoin Flag to allow external join
 * @param  {Object}      config.unzipArtifactsEnabled  Flag to allow unzip artifacts
 * @param  {Function}    callback                   Callback to invoke when server has started.
 * @return {http.Server}                            A listener: NodeJS http.Server object
 */

module.exports = async config => {
    try {
        // Hapi Cross-origin resource sharing configuration
        // See http://hapijs.com/api for available options

        let corsOrigins = [config.ecosystem.ui];

        if (Array.isArray(config.ecosystem.allowCors)) {
            corsOrigins = corsOrigins.concat(config.ecosystem.allowCors);
        }

        const cors = {
            origin: corsOrigins,
            additionalExposedHeaders: ['x-more-data'],
            credentials: true
        };
        // Create a server with a host and port
        const server = new Hapi.Server({
            port: config.httpd.port,
            host: config.httpd.host,
            uri: config.httpd.uri,
            routes: {
                cors,
                log: { collect: true }
            },
            state: {
                strictHeader: false
            },
            router: {
                stripTrailingSlash: true
            }
        });

        // Set the factories within server.app
        // Instantiating the server with the factories will apply a shallow copy
        server.app = {
            commandFactory: config.commandFactory,
            commandTagFactory: config.commandTagFactory,
            templateFactory: config.templateFactory,
            templateTagFactory: config.templateTagFactory,
            stageFactory: config.stageFactory,
            triggerFactory: config.triggerFactory,
            pipelineFactory: config.pipelineFactory,
            jobFactory: config.jobFactory,
            userFactory: config.userFactory,
            buildFactory: config.buildFactory,
            stepFactory: config.stepFactory,
            bannerFactory: config.bannerFactory,
            secretFactory: config.secretFactory,
            tokenFactory: config.tokenFactory,
            eventFactory: config.eventFactory,
            collectionFactory: config.collectionFactory,
            buildClusterFactory: config.buildClusterFactory,
            ecosystem: config.ecosystem,
            release: config.release,
            queueWebhook: config.queueWebhook,
            unzipArtifacts: config.unzipArtifactsEnabled
        };

        const bellConfigs = await config.auth.scm.getBellConfiguration();

        config.auth.bell = bellConfigs;

        if (config.release && config.release.cookieName) {
            server.state(config.release.cookieName, {
                path: '/',
                ttl: config.release.cookieTimeout * 60 * 1000, // (2 mins)
                isSecure: config.auth.https,
                isHttpOnly: !config.auth.https
            });
        }

        // Write prettier errors
        server.ext('onPreResponse', prettyPrintErrors);

        // Audit log
        if (config.log && config.log.audit.enabled) {
            server.ext('onCredentials', (request, h) => {
                const { username, scope, pipelineId } = request.auth.credentials;

                if (scope) {
                    const validScope = config.log.audit.scope.filter(s => scope.includes(s));

                    if (Array.isArray(validScope) && validScope.length > 0) {
                        let context;

                        if (validScope.includes('admin')) {
                            context = `Admin ${username}`;
                        } else if (validScope.includes('user')) {
                            context = `User ${username}`;
                        } else if (validScope.includes('build') || validScope.includes('temporal')) {
                            context = `Build ${username}`;
                        } else if (validScope.includes('pipeline')) {
                            context = `Pipeline ${pipelineId}`;
                        } else {
                            context = `Guest ${username}`;
                        }

                        logger.info(`[Login] ${context} ${request.method} ${request.path}`);
                    }
                }

                return h.continue;
            });
        }

        // Register events for notifications plugin
        server.event(['build_status', 'job_status']);

        // Register plugins
        await registerPlugins(server, config);

        // Initialize common data in buildFactory and jobFactory
        server.app.buildFactory.apiUri = server.info.uri;
        server.app.buildFactory.tokenGen = (buildId, metadata, scmContext, expiresIn, scope = ['temporal']) =>
            server.plugins.auth.generateToken(
                server.plugins.auth.generateProfile(buildId, scmContext, scope, metadata),
                expiresIn
            );
        server.app.buildFactory.executor.tokenGen = server.app.buildFactory.tokenGen;

        server.app.jobFactory.apiUri = server.info.uri;
        server.app.jobFactory.tokenGen = (username, metadata, scmContext, scope = ['user']) =>
            server.plugins.auth.generateToken(
                server.plugins.auth.generateProfile(username, scmContext, scope, metadata)
            );
        server.app.jobFactory.executor.userTokenGen = server.app.jobFactory.tokenGen;

        if (server.plugins.shutdown) {
            server.plugins.shutdown.handler({
                taskname: 'executor-queue-cleanup',
                task: async () => {
                    await server.app.jobFactory.cleanUp();
                    logger.info('completed clean up tasks');
                }
            });
        }

        // Start the server
        await server.start();

        return server;
    } catch (err) {
        logger.error('Failed to start server', err);
        throw err;
    }
};
