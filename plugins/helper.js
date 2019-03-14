'use strict';

/**
 * Set default start time and end time
 * @method setDefaultStartEnd
 * @param  {String}         start     start time
 * @param  {String}         end       end time
 * @param  {Number}         maxDay    max day range
 * @return {Object}                   Default start time and end time
 */
function setDefaultTimeRange(start, end, maxDay) {
    const endTime = end || new Date(Date.now()).toISOString();
    const startTime = start || new Date(new Date().setDate(new Date(endTime).getDate() - maxDay))
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
    const duration = new Date(end) - new Date(start); // in milliseconds
    const dayDiff = duration / 1000 / 60 / 60 / 24;

    return dayDiff >= 0 && dayDiff <= maxDay;
}

module.exports = {
    setDefaultTimeRange,
    validTimeRange
};
