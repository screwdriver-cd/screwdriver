'use strict';

/**
 * Hapi interface for plugin to set release type endpoint
 * @method register
 * @param  {Hapi.Server}    server
 * @param  {Function} next
 */
const releasePlugin = {
    name: 'release',
    async register(server, releaseOptions) {
        server.route({
            method: 'GET',
            path: '/release',
            handler: (_, h) => {
                return h.response(releaseOptions.mode).code(200);
            },
            config: {
                description: 'API Release information',
                notes: 'Should respond with 200',
                tags: ['api'],
                plugins: {
                    'hapi-rate-limit': {
                        enabled: false
                    }
                }
            }
        });
    }
};

module.exports = releasePlugin;
