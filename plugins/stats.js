'use strict';

const schema = require('screwdriver-data-schema');

/**
 * Hapi interface for plugin to set up status endpoint (see Hapi docs)
 * @method register
 * @param  {Hapi.Server}    server
 * @param  {Object}         options
 * @param  {Function} next
 */
const statsPlugin = {
    name: 'stats',
    async register(server, options) {
        const { executor } = options;
        const { scm } = options;

        server.route({
            method: 'GET',
            path: '/stats',
            config: {
                description: 'API stats',
                notes: 'Should return statistics for the entire system',
                tags: ['api', 'stats'],
                plugins: {
                    'hapi-rate-limit': {
                        enabled: false
                    }
                },
                response: {
                    schema: schema.api.stats
                }
            },
            handler: async (request, h) => {
                const executorStats = await executor.stats({ token: '' });

                return h.response({
                    executor: executorStats,
                    scm: scm.stats()
                });
            }
        });
    }
};

module.exports = statsPlugin;
