'use strict';

const logger = require('screwdriver-logger');
const requestretry = require('requestretry');
const config = require('config');
const ecosystem = config.get('ecosystem');

const RETRY_DELAY = 5;
const RETRY_LIMIT = 3;

/**
 * Callback function to retry HTTP status codes > 299
 * @param {Object} err
 * @param {Object} response
 */
const retryStrategyFn = (err, response) => !!err || Math.floor(response.statusCode / 100) !== 2;

/**
 * @method invoke
 * @param {Object} request
 * @param {String} request.method
 * @param {String} request.path
 * @param {Object} request.payload
 * @param {Object} request.headers
 */
async function invoke(request) {
    const { method, path, payload, auth, params } = request;
    const { store, queue, cache } = ecosystem;

    const apiPath = path.replace(/\/v4/, '/v1');
    const options = {
        json: true,
        method,
        uri: `${store}${apiPath}`,
        headers: {
            Authorization: `Bearer ${auth.token}`
        }
    };

    if (cache.strategy === 'disk') {
        const { scope, id } = params;
        const buildClusters = await request.server.app.buildClusterFactory.list();

        Object.assign(options, {
            method: 'POST',
            uri: `${queue}/v1/queue/message?type=cache`,
            body: {
                scope,
                id,
                buildClusters
            }
        });
    }

    if (payload) {
        if (options.body) {
            Object.assign(options.body, payload);
        } else {
            Object.assign(options, { body: payload });
        }
    }

    if (retryStrategyFn) {
        Object.assign(options, {
            retryStrategy: retryStrategyFn,
            maxAttempts: RETRY_LIMIT,
            retryDelay: RETRY_DELAY * 1000 // in ms
        });
    }

    logger.info(`${options.method} ${options.uri} Cache invalidation request for ${params.scope}:${params.id}`);

    return new Promise((resolve, reject) => {
        requestretry(options, (err, res) => {
            if (!err) {
                resolve(res);
            }

            logger.error('Error occured while clearing cache', err);
            reject(err);
        });
    });
}

module.exports.invoke = invoke;
