'use strict';

const logger = require('screwdriver-logger');
const requestretry = require('requestretry');

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
    const { method, payload, query, auth, params } = request;
    const pipelineId = params.id;
    const { store, queue, cache } = request.server.app.ecosystem;
    const { scope, cacheId } = query;
    const { username, scmContext } = auth.credentials;

    const token = request.server.plugins.auth.generateToken(
        request.server.plugins.auth.generateProfile(username, scmContext, ['sdapi'], { pipelineId })
    );

    const options = {
        json: true,
        method,
        uri: `${store}/v1/caches/${scope}/${cacheId}`,
        headers: {
            Authorization: `Bearer ${token}`
        }
    };

    if (cache.strategy === 'disk') {
        const clusters = await request.server.app.buildClusterFactory.list();

        if (!clusters || clusters.length === 0) {
            logger.warn('No buildclusters found');
        }
        const buildClusters = clusters.map(cluster => cluster.name);

        logger.info(`Processing invalidation request with buildClusters: ${buildClusters}`);

        Object.assign(options, {
            method: 'POST',
            uri: `${queue}/v1/queue/message?type=cache`,
            body: {
                scope,
                id: cacheId,
                buildClusters,
                pipelineId
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

    logger.info(
        `${options.method} ${options.uri} Cache invalidation request for pipelineId:${pipelineId} ${query.scope}:${query.cacheId}`
    );

    return new Promise((resolve, reject) => {
        requestretry(options, (err, res) => {
            if (!err) {
                return resolve(res);
            }
            logger.error('Error occured while clearing cache', err);

            return reject(err);
        });
    });
}

module.exports.invoke = invoke;
