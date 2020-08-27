'use strict';

const { getSummary } = require('@promster/hapi');

/**
 * Hapi interface for plugin to set up metrics endpoint
 * @method register
 * @param  {Hapi.Server}    server
 * @param  {Object}         options
 * @param  {Function} next
 */
module.exports.attributesPlugin = {
    name: 'metrics',
    async register = (server, options) => {
        // Add the status route
        server.route({
            method: 'GET',
            path: '/metrics',
            handler: (request, h) => h.response(getSummary()),
            config: {
                description: 'application metrics',
                notes: 'Expose application metrics',
                tags: ['api']
            }
        });
    }
};

