'use strict';

const boom = require('@hapi/boom');
const jwt = require('jsonwebtoken');
const logger = require('screwdriver-logger');
const ndjson = require('ndjson');
const request = require('screwdriver-request');
const schema = require('screwdriver-data-schema');
const { v4: uuidv4 } = require('uuid');

const MAX_LINES_SMALL = 100;
const MAX_LINES_BIG = 1000;

/**
 * Makes the request to the Store to get lines from a log
 * @param  {Object}     config
 * @param  {String}     config.baseUrl             URL to load from (without the .$PAGE)
 * @param  {Integer}    config.linesFrom           Line number to start loading from
 * @param  {String}     config.authToken           Bearer Token to be passed to the Store
 * @param  {Integer}    config.page                Log page to load
 * @param  {String}     config.sort                Method for sorting log lines ('ascending' or 'descending')
 * @return {Promise}                               [Array of log lines]
 */
async function fetchLog({ baseUrl, linesFrom, authToken, page, sort }) {
    const output = [];
    const requestStream = request.stream(`${baseUrl}.${page}`, {
        method: 'GET',
        headers: {
            Authorization: authToken
        }
    });

    return new Promise((resolve, reject) => {
        requestStream.on('error', err => {
            if (err.response && err.response.statusCode === 404) {
                resolve([]);
            } else {
                reject(err);
            }
        });
        requestStream
            // Parse the ndjson
            .pipe(ndjson.parse({ strict: false }))
            // Only save lines that we care about
            .on('data', line => {
                const isNextLine = sort === 'ascending' ? line.n >= linesFrom : line.n <= linesFrom;

                if (isNextLine) {
                    output.push(line);
                }
            })
            .on('end', () => resolve(output));
    });
}

/**
 * Returns number of lines per file based on lines returned for page 0
 * @method getMaxLines
 * @param  {Object}     config
 * @param  {String}     config.baseUrl             URL to load from (without the .$PAGE)
 * @param  {String}     config.authToken           Bearer Token to be passed to the Store
 * @return {Promise}                               Resolves max lines per file
 */
async function getMaxLines({ baseUrl, authToken }) {
    let linesInFirstPage;

    // check lines per file by looking at the first file
    try {
        linesInFirstPage = await fetchLog({
            baseUrl,
            authToken,
            sort: 'ascending',
            linesFrom: 0,
            page: 0
        });
    } catch (err) {
        logger.error(err);
        throw new Error(err);
    }

    return linesInFirstPage.length > MAX_LINES_SMALL ? MAX_LINES_BIG : MAX_LINES_SMALL;
}

/**
 * Load up to N pages that are available
 * @method loadLines
 * @param  {Object}     config
 * @param  {String}     config.baseUrl             URL to load from (without the .$PAGE)
 * @param  {Integer}    config.linesFrom           Line number to start loading from
 * @param  {String}     config.authToken           Bearer Token to be passed to the Store
 * @param  {Integer}    [config.pagesToLoad=10]    Number of pages left to load
 * @param  {String}     [config.sort='ascending']  Method for sorting log lines ('ascending' or 'descending')
 * @param  {Integer}    config.maxLines            Max lines per log file
 * @return {Promise}                               [Array of log lines, Are there more pages]
 */
async function loadLines({ baseUrl, linesFrom, authToken, pagesToLoad = 10, sort = 'ascending', maxLines }) {
    const page = Math.floor(linesFrom / maxLines);
    let morePages = false;
    let lines;

    try {
        lines = await fetchLog({ baseUrl, linesFrom, authToken, page, sort });
    } catch (err) {
        logger.error(err);
        throw new Error(err);
    }

    const linesCount = lines.length;
    const pagesToLoadUpdated = pagesToLoad - 1;
    const linesFromUpdated = sort === 'descending' ? linesFrom - linesCount : linesCount + linesFrom;
    // If we got lines AND there are more lines to load
    const descLoadNext = sort === 'descending' && linesCount > 0 && linesFrom - linesCount > 0;
    // If we got lines AND we reached the edge of a page
    const ascLoadNext = sort === 'ascending' && linesCount > 0 && (linesCount + linesFrom) % maxLines === 0;

    // Load from next log if there's still lines left
    if (ascLoadNext || descLoadNext) {
        if (pagesToLoadUpdated > 0) {
            const loadConfig = {
                baseUrl,
                linesFrom: linesFromUpdated,
                authToken,
                pagesToLoad: pagesToLoadUpdated,
                sort,
                maxLines
            };

            return loadLines(loadConfig).then(([nextLines, pageLimit]) => {
                if (sort === 'descending') {
                    return [nextLines.concat(lines), pageLimit];
                }

                return [lines.concat(nextLines), pageLimit];
            });
        }
        // Otherwise exit early and flag that there may be more pages
        morePages = true;
    }

    return [lines, morePages];
}

/**
 * Convert unix milliseconds to ISO 8610 with timezone format
 * @param   {number}    timestamp   TimeStamp in unix milliseconds format
 * @param   {string}    timeZone    Timezone of timestamp
 * @returns {string}                Datetime in ISO 8610 with timezone format (e.g., YYYY-MM-DDThh:mm:ss.sssZ, YYYY-MM-DDThh:mm:ss.sss+09:00)
 */
function unixToFullTime(timestamp, timeZone) {
    const date = new Date(timestamp);
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        fractionalSecondDigits: 3,
        hour12: false,
        timeZoneName: 'longOffset'
    });
    const { year, day, month, hour, minute, second, fractionalSecond, timeZoneName } = Object.fromEntries(
        formatter.formatToParts(date).map(({ type, value }) => [type, value])
    );

    const offsetMatch = timeZoneName.match(/GMT(.*)/)[1];

    const timezoneOffset = offsetMatch === '' ? 'Z' : offsetMatch;

    return `${year}-${month}-${day}T${hour}:${minute}:${second}.${fractionalSecond}${timezoneOffset}`;
}

/**
 * Convert unix milliseconds to Datetime with Timezone
 * @param   {number}    timestamp   TimeStamp in unix milliseconds format
 * @param   {string}    timeZone    Timezone of timestamp
 * @returns {string}                Datetime in hh:mm:ss format
 */
function unixToSimpleTime(timestamp, timeZone) {
    const date = new Date(timestamp);
    const options = {
        timeZone,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    };

    return date.toLocaleString(undefined, options);
}

/**
 * Convert to target and source unix milliseconds duration
 * @param   {number}    sourceTimestamp     Source timeStamp in unix milliseconds format
 * @param   {number}    targetTimestamp     Target timeStamp in unix milliseconds format
 * @returns {string}                        Duration in hh:mm:ss format
 */
function durationTime(sourceTimestamp, targetTimestamp) {
    const differenceInMilliSeconds = targetTimestamp - sourceTimestamp;
    const differenceInSeconds = Math.floor(differenceInMilliSeconds / 1000);
    const differenceInSecondsMod = differenceInSeconds % 3600;

    const hours = Math.floor(differenceInSeconds / 3600);
    const minutes = Math.floor(differenceInSecondsMod / 60);
    const seconds = (differenceInSecondsMod % 60).toString().padStart(2, '0');

    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

module.exports = config => ({
    method: 'GET',
    path: '/builds/{id}/steps/{name}/logs',
    options: {
        description: 'Get the logs for a build step',
        notes: 'Returns the logs for a step',
        tags: ['api', 'builds', 'steps', 'log'],
        auth: {
            strategies: ['token', 'session'],
            scope: ['user', 'pipeline', 'build']
        },

        handler: (req, h) => {
            const { credentials } = req.auth;
            const { canAccessPipeline } = req.server.plugins.pipelines;
            const { stepFactory, buildFactory, eventFactory } = req.server.app;
            const buildId = req.params.id;
            const stepName = req.params.name;
            let buildModel;

            return buildFactory
                .get(buildId)
                .then(build => {
                    if (!build) {
                        throw boom.notFound('Build does not exist');
                    }
                    buildModel = build;

                    return eventFactory.get(build.eventId);
                })
                .then(event => {
                    if (!event) {
                        throw boom.notFound('Event does not exist');
                    }

                    return canAccessPipeline(credentials, event.pipelineId, 'pull', req.server.app);
                })
                .then(() => stepFactory.get({ buildId, name: stepName }))
                .then(stepModel => {
                    if (!stepModel) {
                        throw boom.notFound('Step does not exist');
                    }

                    const isNotStarted = stepModel.startTime === undefined;
                    const output = [];

                    if (isNotStarted) {
                        return h.response(output).header('X-More-Data', 'false');
                    }

                    const isDone = stepModel.code !== undefined;
                    const baseUrl = `${config.ecosystem.store}/v1/builds/${buildId}/${stepName}/log`;
                    const authToken = jwt.sign(
                        {
                            buildId,
                            stepName,
                            scope: ['user']
                        },
                        config.authConfig.jwtPrivateKey,
                        {
                            algorithm: 'RS256',
                            expiresIn: '300s',
                            jwtid: uuidv4()
                        }
                    );

                    const { sort, type, timestamp, timezone, timestampFormat } = req.query;

                    let pagesToLoad = req.query.pages;
                    let linesFrom = req.query.from;

                    if (type === 'download' && isDone) {
                        // 100 lines per page
                        pagesToLoad = Math.ceil(stepModel.lines / 100);
                        linesFrom = 0;
                    }

                    return getMaxLines({ baseUrl, authToken })
                        .then(maxLines =>
                            loadLines({
                                baseUrl,
                                linesFrom,
                                authToken,
                                pagesToLoad,
                                sort,
                                maxLines
                            })
                        )
                        .then(([lines, morePages]) => {
                            if (type !== 'download') {
                                return h.response(lines).header('X-More-Data', (morePages || !isDone).toString());
                            }

                            let res = '';

                            if (timestamp) {
                                const buildTime = new Date(buildModel.startTime).getTime();
                                const stepTime = new Date(stepModel.startTime).getTime();

                                switch (timestampFormat) {
                                    case 'full-time':
                                        for (const line of lines) {
                                            res += `${unixToFullTime(line.t, timezone)}\t${line.m}\n`;
                                        }
                                        break;
                                    case 'simple-time':
                                        for (const line of lines) {
                                            res += `${unixToSimpleTime(line.t, timezone)}\t${line.m}\n`;
                                        }
                                        break;
                                    case 'elapsed-build':
                                        for (const line of lines) {
                                            const duration = durationTime(buildTime, line.t);

                                            res += `${duration}\t${line.m}\n`;
                                        }
                                        break;
                                    case 'elapsed-step':
                                        for (const line of lines) {
                                            const duration = durationTime(stepTime, line.t);

                                            res += `${duration}\t${line.m}\n`;
                                        }
                                        break;
                                    default:
                                        throw boom.badRequest('Unexpected timestampFormat parameter');
                                }
                            } else {
                                for (const line of lines) {
                                    res += `${line.m}\n`;
                                }
                            }

                            return h
                                .response(res)
                                .type('text/plain')
                                .header('content-disposition', `attachment; filename="${stepName}-log.txt"`);
                        });
                })
                .catch(err => {
                    throw err;
                });
        },
        response: {
            schema: schema.api.loglines.output
        },
        validate: {
            params: schema.api.loglines.params,
            query: schema.api.loglines.query
        }
    }
});
