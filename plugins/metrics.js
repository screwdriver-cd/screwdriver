'use strict';

const { getSummary } = require('@promster/hapi');

/**
 * Hapi interface for plugin to set up metrics endpoint
 * @method register
 * @param  {Hapi.Server}    server
 * @param  {Object}         options
 * @param  {Function} next
 */
module.exports = {
    name: 'metrics',
    async register(server) {
        // Add the status route
        server.route({
            method: 'GET',
            path: '/metrics',
            handler: async (_, h) => h.response(await getSummary()),
            config: {
                plugins: {
                    'hapi-rate-limit': {
                        enabled: false
                    }
                },
                description: 'application metrics',
                notes: 'Expose application metrics',
                tags: ['api']
            }
        });
    }
};
