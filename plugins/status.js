'use strict';

const schema = require('screwdriver-data-schema');

/**
 * Hapi interface for plugin to set up status endpoint (see Hapi docs)
 * @method register
 * @param  {Hapi.Server}    server
 * @param  {Function} next
 */
const statusPlugin = {
    name: 'status',
    async register(server) {
        server.route({
            method: 'GET',
            path: '/status',
            handler: (_, h) => h.response('OK').code(200),
            config: {
                description: 'API status',
                notes: 'Should respond with 200: ok',
                tags: ['api'],
                response: {
                    schema: schema.api.status
                }
            }
        });
    }
};

module.exports = statusPlugin;
