'use strict';

const Hapi = require('hapi');
const logger = require('screwdriver-logger');
const registrationMan = require('./registerPlugins');

process.on('unhandledRejection', (reason, p) => {
    console.error('Unhandled Rejection at: Promise', p, 'reason:', reason);
});

/**
 * If we're throwing errors, let's have them say a little more than just 500
 * @method prettyPrintErrors
 * @param  {Hapi.Request}    request Hapi Request object
 * @param  {Hapi.Reply}      reply   Hapi Reply object
 */
function prettyPrintErrors(request, reply) {
    if (request.response.isBoom) {
        const { message: errMessage, data, output, stack } = request.response;
        const { statusCode, error: errName } = output.payload;

        if (statusCode === 500) {
            request.log(['server', 'error'], stack || errMessage);
        }

        const response = {
            statusCode,
            error: errName,
            message: errMessage
        };

        if (data) {
            response.data = data;
        }

        return reply(response).code(statusCode);
    }

    return reply.continue();
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
 * @param  {Factory}     config.triggerFactory      Trigger Factory instance
 * @param  {Object}      config.builds              Config to include for builds plugin
 * @param  {Object}      config.builds.ecosystem    List of hosts in the ecosystem
 * @param  {Object}      config.builds.authConfig   Configuration for auth
 * @param  {Object}      config.builds.externalJoin Flag to allow external join
 * @param  {Function}    callback                   Callback to invoke when server has started.
 * @return {http.Server}                            A listener: NodeJS http.Server object
 */
module.exports = config => {
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
        connections: {
            routes: {
                cors,
                log: true
            },
            router: {
                stripTrailingSlash: true
            }
        }
    });

    // Set the factorys within server.app
    // Instantiating the server with the factories will apply a shallow copy
    server.app = {
        commandFactory: config.commandFactory,
        commandTagFactory: config.commandTagFactory,
        templateFactory: config.templateFactory,
        templateTagFactory: config.templateTagFactory,
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
        ecosystem: config.ecosystem
    };

    // Initialize server connections
    server.connection(config.httpd);
    // Write prettier errors
    server.ext('onPreResponse', prettyPrintErrors);

    // Register build_status event for notifications plugin
    server.event('build_status');

    // Register plugins
    return registrationMan(server, config).then(() => {
        // Initialize common data in buildFactory and jobFactory

        server.app.buildFactory.apiUri = server.info.uri;
        server.app.buildFactory.tokenGen = (buildId, metadata, scmContext, expiresIn) =>
            server.plugins.auth.generateToken(
                server.plugins.auth.generateProfile(buildId, scmContext, ['temporal'], metadata),
                expiresIn
            );
        server.app.buildFactory.executor.tokenGen = server.app.buildFactory.tokenGen;

        server.app.jobFactory.apiUri = server.info.uri;
        server.app.jobFactory.tokenGen = (username, metadata, scmContext) =>
            server.plugins.auth.generateToken(
                server.plugins.auth.generateProfile(username, scmContext, ['user'], metadata)
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
        return server
            .start()
            .then(() => server)
            .catch(err => logger.error('Failed to start server', err));
    });
};
