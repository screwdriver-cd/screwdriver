'use strict';

const schema = require('screwdriver-data-schema');

/**
 * Hapi interface for plugin to set up status endpoint (see Hapi docs)
 * @method register
 * @param  {Hapi.Server}    server
 * @param  {Object}         options
 * @param  {Function} next
 */
exports.register = (server, options, next) => {
    // Add the status route
    server.route({
        method: 'GET',
        path: '/status',
        handler: (request, reply) => reply('OK'),
        config: {
            description: 'API status',
            notes: 'Should respond with 200: ok',
            tags: ['api'],
            response: {
                schema: schema.api.status
            }
        }
    });
    next();
};

exports.register.attributes = {
    name: 'server status',
    version: '1.0.0'
};
