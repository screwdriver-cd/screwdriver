'use strict';

const dayjs = require('dayjs');
const Redis = require('ioredis');
const Redlock = require('redlock');
const config = require('config');

/**
 * locks a resource using redlock
 * @method lockResource
 * @param  {String}         resource  resource to lock
 * @param  {Number}         ttl       maximum lock duration
 * @return {Promise}                  Resolves to a lock
 */
function lockResource(resource, ttl) {
    if (!config.get('executor.redisLock.enabled')) {
        return Promise.resolve(null);
    }

    const redisLockConfig = config.get('executor.redisLock.options');
    const connectionDetails = {
        host: redisLockConfig.redisConnection.host,
        options: {
            password: redisLockConfig.redisConnection.options && redisLockConfig.redisConnection.options.password,
            tls: redisLockConfig.redisConnection.options ? redisLockConfig.redisConnection.options.tls : false
        },
        port: redisLockConfig.redisConnection.port
    };
    const redis = new Redis(connectionDetails.port, connectionDetails.host, connectionDetails.options);
    const redlock = new Redlock([redis], {
        driftFactor: redisLockConfig.driftFactor,
        retryCount: redisLockConfig.retryCount,
        retryDelay: redisLockConfig.retryDelay,
        retryJitter: redisLockConfig.retryJitter
    });

    return redlock.lock(resource, ttl);
}

/**
 * Set default start time and end time
 * @method setDefaultStartEnd
 * @param  {String}         start     start time
 * @param  {String}         end       end time
 * @param  {Number}         maxDay    max day range
 * @return {Object}                   Default start time and end time
 */
function setDefaultTimeRange(start, end, maxDay) {
    const endTime = end || new Date().toISOString();
    const startTime =
        start ||
        dayjs(endTime)
            .subtract(maxDay, 'days')
            .toISOString();

    return { startTime, endTime };
}

/**
 * Check if the time range is valid
 * @method validTimeRange
 * @param  {String}         start   start time
 * @param  {String}         end     end time
 * @param  {Number}         maxDay  max day range
 * @return {Boolean}                True if time range is valid. False otherwise
 */
function validTimeRange(start, end, maxDay) {
    const dayDiff = dayjs(end).diff(dayjs(start), 'days');

    return dayDiff >= 0 && dayDiff <= maxDay;
}

module.exports = {
    setDefaultTimeRange,
    validTimeRange,
    lockResource
};
