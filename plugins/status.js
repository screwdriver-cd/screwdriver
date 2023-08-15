'use strict';

const logger = require('screwdriver-logger');
const schema = require('screwdriver-data-schema');
const requestRetry = require('screwdriver-request');

const RETRY_LIMIT = 2;
const RETRY_DELAY = 5; // in seconds
const HTTP_TIMEOUT = 1000 // in ms

/**
 * Makes api call to the url endpoint
 * @async invoke
 * @param {String} url
 * @return Promise.resolve
 */
async function invoke(url) {
    logger.info(`GET ${url}`);

    const options = {
        url,
        retry: {
            limit: RETRY_LIMIT,
            calculateDelay: ({ computedValue }) => (computedValue ? RETRY_DELAY * 1000 : 0) // in ms
        },
        method: 'GET',
        responseType: 'text',
        timeout: HTTP_TIMEOUT
    };

    try {
        const result = await requestRetry(options);
        
        return result.statusCode;
    } catch (err) {
        logger.error(`Failed to get ${url}: ${err.message}`);
        return err.statusCode;
    };
}

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
            handler: async (request, h) => {
                const { exhaustive } = request.query;

                if (exhaustive) {
                    const queueResponseCode = await invoke(`${request.server.app.ecosystem.queue}/v1/status`);
                    if (queueResponseCode !== 200) {
                        return h.response('SD Queue Service Unavailable').code(queueResponseCode);
                    }
                    const storeResponseCode = await invoke(`${request.server.app.ecosystem.store}/v1/status`);
                    if (storeResponseCode !== 200) {
                        return h.response('SD Store Unavailable').code(storeResponseCode);
                    }
                }
                return h.response('OK').code(200)
            },
            config: {
                description: 'API status',
                notes: 'Should respond with 200: ok',
                tags: ['api'],
                plugins: {
                    'hapi-rate-limit': {
                        enabled: false
                    }
                },
                response: {
                    schema: schema.api.status
                }
            }
        });
    }
};

module.exports = statusPlugin;
