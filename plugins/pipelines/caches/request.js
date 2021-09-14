'use strict';

const logger = require('screwdriver-logger');
const requestretry = require('screwdriver-request');

const RETRY_DELAY = 5;
const RETRY_LIMIT = 3;

/**
 * Callback function to retry HTTP status codes > 299
 * @param   {Object}    response
 * @param   {Function}  retryWithMergedOptions
 * @return  {Object}    Response
 */
const retryStrategyFn = response => {
    if (Math.floor(response.statusCode / 100) !== 2) {
        throw new Error('Retry limit reached');
    }

    return response;
};

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
        method,
        url: `${store}/v1/caches/${scope}/${cacheId}`,
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
            url: `${queue}/v1/queue/message?type=cache`,
            json: {
                scope,
                id: cacheId,
                buildClusters,
                pipelineId
            }
        });
    }

    if (payload) {
        if (options.json) {
            Object.assign(options.json, payload);
        } else {
            Object.assign(options, { json: payload });
        }
    }

    if (retryStrategyFn) {
        const retry = {
            limit: RETRY_LIMIT,
            calculateDelay: ({ computedValue }) => (computedValue ? RETRY_DELAY * 1000 : 0) // in ms
        };

        if (method === 'POST') {
            Object.assign(retry, {
                methods: ['POST']
            });
        }

        Object.assign(options, {
            retry,
            hooks: {
                afterResponse: [retryStrategyFn]
            }
        });
    }

    logger.info(
        `${options.method} ${options.uri} Cache invalidation request for pipelineId:${pipelineId} ${query.scope}:${query.cacheId}`
    );

    return requestretry(options).catch(err => {
        logger.error('Error occured while clearing cache', err);

        return Promise.reject(err);
    });
}

module.exports.invoke = invoke;
