'use strict';
const Hapi = require('hapi');
const registrationMan = require('./registerPlugins');

/**
 * If we're throwing errors, let's have them say a little more than just 500
 * @method prettyPrintErrors
 * @param  {Hapi.Request}    request Hapi Request object
 * @param  {Hapi.Reply}      reply   Hapi Reply object
 */
function prettyPrintErrors(request, reply) {
    if (request.response.isBoom) {
        const err = request.response;
        const errName = err.output.payload.error;
        const errMessage = err.message;
        const statusCode = err.output.payload.statusCode;
        const stack = err.stack || errMessage;

        if (statusCode === 500) {
            request.log(['server', 'error'], stack);
        }

        return reply({
            statusCode,
            error: errName,
            message: errMessage
        }).code(statusCode);
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
 * @param  {Object}      config.ecosystem           List of hosts in the ecosystem
 * @param  {Object}      config.ecosystem.ui        URL for the User Interface
 * @param  {Factory}     config.pipelineFactory     Pipeline Factory instance
 * @param  {Factory}     config.jobFactory          Job Factory instance
 * @param  {Factory}     config.userFactory         User Factory instance
 * @param  {Factory}     config.buildFactory        Build Factory instance
 * @param  {Factory}     config.secretFactory       Secret Factory instance
 * @param  {Function}    callback                   Callback to invoke when server has started.
 * @return {http.Server}                            A listener: NodeJS http.Server object
 */
module.exports = (config, callback) => {
    // Hapi Cross-origin resource sharing configuration
    // See http://hapijs.com/api for available options
    const cors = {
        origin: [
            config.ecosystem.ui
        ],
        additionalExposedHeaders: [
            'x-more-data'
        ]
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
        pipelineFactory: config.pipelineFactory,
        jobFactory: config.jobFactory,
        userFactory: config.userFactory,
        buildFactory: config.buildFactory,
        secretFactory: config.secretFactory
    };

    // Initialize server connections
    server.connection(config.httpd);
    // Write prettier errors
    server.ext('onPreResponse', prettyPrintErrors);

    // Register plugins
    registrationMan(server, config, (err) => {
        if (err) {
            return callback(err);
        }

        // Initialize common data in buildFactory
        if (server.app.buildFactory) {
            server.app.buildFactory.apiUri = server.info.uri;
            server.app.buildFactory.tokenGen = (buildId, metadata) =>
                server.plugins.auth.generateToken(
                    server.plugins.auth.generateProfile(buildId, ['build'], metadata)
                );
        }

        // Start the server
        server.start((error) => { callback(error, server); });

        return 0;
    });
};
