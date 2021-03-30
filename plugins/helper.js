'use strict';

const dayjs = require('dayjs');
const Redis = require('ioredis');
const Redlock = require('redlock');
const config = require('config');
const redisConfig = config.get('executor.queue.options.redisConnection');
const connectionDetails = {
    host: redisConfig.host,
    options: {
        password: redisConfig.options && redisConfig.options.password,
        tls: redisConfig.options ? redisConfig.options.tls : false
    },
    port: redisConfig.port
};
const redis = new Redis(connectionDetails.port, connectionDetails.host, connectionDetails.options);
// https://github.com/mike-marcacci/node-redlock
const redlock = new Redlock([redis], {
    driftFactor: 0.01, // time in ms
    retryCount: 5,
    retryDelay: 500, // time in ms
    retryJitter: 200 // time in ms
});

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
    redlock
};
