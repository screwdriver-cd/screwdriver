'use strict';

const boom = require('@hapi/boom');
const jwt = require('jsonwebtoken');
const logger = require('screwdriver-logger');
const ndjson = require('ndjson');
const request = require('screwdriver-request');
const schema = require('screwdriver-data-schema');
const uuid = require('uuid');

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
        requestStream
            .on('error', e => reject(e))
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

            return buildFactory
                .get(buildId)
                .then(build => {
                    if (!build) {
                        throw boom.notFound('Build does not exist');
                    }

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
                            jwtid: uuid.v4()
                        }
                    );
                    const { sort, type } = req.query;
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

                            for (let i = 0; i < lines.length; i += 1) {
                                res = `${res}${lines[i].m}\n`;
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
