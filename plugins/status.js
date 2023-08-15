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

        return { code: result.statusCode, body: result.body };
    } catch (err) {
        logger.error(`Failed to get ${url}: ${err.message}`);

        return { code: err.statusCode, body: err.message };
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
                    const responses = await Promise.all([
                        invoke(`${request.server.app.ecosystem.queue}/v1/status`),
                        invoke(`${request.server.app.ecosystem.store}/v1/status`)
                    ]);

                    const response = responses.find(r => r.code !== 200);
                    const code = response ? response.code : 200;

                    return h.response({
                        queue: responses[0].body,
                        store: responses[1].body,
                        api: 'OK'
                    }).code(code);

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
