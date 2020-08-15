'use strict';

const { getSummary } = require('@promster/hapi');

/**
 * Hapi interface for plugin to set up metrics endpoint
 * @method register
 * @param  {Hapi.Server}    server
 * @param  {Object}         options
 * @param  {Function} next
 */
exports.register = (server, options, next) => {
    // Add the status route
    server.route({
        method: 'GET',
        path: '/metrics',
        handler: (request, reply) => reply(getSummary()),
        config: {
            description: 'application metrics',
            notes: 'Expose application metrics',
            tags: ['api']
        }
    });
    next();
};

exports.register.attributes = {
    name: 'application metrics',
    version: '1.0.0'
};
