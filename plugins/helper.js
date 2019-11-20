'use strict';

const dayjs = require('dayjs');
const winston = require('winston');

const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    transports: [
        new (winston.transports.Console)({ timestamp: true })
    ]
});

/**
 * Get logger object for model
 * @method getLogger
 * @return {Object}  winston logger object for model
 */
function getLogger() {
    return logger;
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
    const startTime = start || dayjs(endTime).subtract(maxDay, 'days').toISOString();

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
    getLogger
};
