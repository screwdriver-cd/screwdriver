'use strict';

const rateLimit = require('hapi-rate-limit');
const config = require('config');
const rateLimitConfig = config.get('rateLimit');

module.exports = {
    name: 'ratelimit',
    async register(server) {
        server.ext('onPreAuth', async (request, h) => {
            // see https://github.com/glennjones/hapi-swagger/issues/623
            if (request.path.startsWith('/v4/swagger')) {
                request.route.settings.plugins['hapi-rate-limit'] = {
                    enabled: false
                };
            }

            return h.continue;
        });

        await server.register({
            plugin: rateLimit,
            options: {
                enabled: rateLimitConfig.enabled || false,
                userLimit: rateLimitConfig.limit,
                userAttribute: 'jti',
                userCache: {
                    expiresIn: rateLimitConfig.duration
                },
                authLimit: false,
                headers: false,
                pathLimit: false,
                userPathLimit: false,
                trustProxy: true
            }
        });
    }
};
