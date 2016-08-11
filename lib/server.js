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

        if (statusCode === 500) {
            request.log(['server'], err.stack);
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
 * @param  {String}      config.httpd.host          Public hostname
 * @param  {Object}      config.httpd.tls           TLS Configuration
 * @param  {Factory}     config.pipelineFactory     Pipeline Factory instance
 * @param  {Factory}     config.jobFactory          Job Factory instance
 * @param  {Factory}     config.userFactory         User Factory instance
 * @param  {Factory}     config.buildFactory        Build Factory instance
 * @param  {Function}    callback                   Callback to invoke when server has started.
 * @return {http.Server}                            A listener: NodeJS http.Server object
 */
module.exports = (config, callback) => {
    // Create a server with a host and port
    const server = new Hapi.Server({
        app: {
            pipelineFactory: config.pipelineFactory,
            jobFactory: config.jobFactory,
            userFactory: config.userFactory,
            buildFactory: config.buildFactory
        }
    });

    // Initialize server connections
    server.connection(config.httpd);
    // Write prettier errors
    server.ext('onPreResponse', prettyPrintErrors);

    // Register plugins
    registrationMan(server, config, (err) => {
        if (err) {
            return callback(err);
        }

        // Start the server
        server.start((error) => { callback(error, server); });

        return 0;
    });
};
