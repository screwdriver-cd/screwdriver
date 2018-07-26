'use strict';

const boom = require('boom');
const schema = require('screwdriver-data-schema');
const request = require('request');
const ndjson = require('ndjson');
const winston = require('winston');
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

    return new Promise((resolve, reject) => {
        request
            .get({
                url: `${baseUrl}.${page}`,
                headers: {
                    Authorization: authToken
                }
            })
            .on('error', e => reject(e))
            // Parse the ndjson
            .pipe(ndjson.parse({
                strict: false
            }))
            // Only save lines that we care about
            .on('data', (line) => {
                const isNextLine = sort === 'ascending' ? line.n >= linesFrom : line.n <= linesFrom;

                if (isNextLine) {
                    output.push(line);
                }
            })
            .on('end', () => resolve(output));
    });
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
 * @return {Promise}                               [Array of log lines, Are there more pages]
 */
async function loadLines({
    baseUrl,
    linesFrom,
    authToken,
    pagesToLoad = 10,
    sort = 'ascending',
    maxLines = MAX_LINES_SMALL
}) {
    const page = sort === 'ascending' ?
        Math.floor(linesFrom / maxLines) : Math.floor(linesFrom / MAX_LINES_BIG);
    let morePages = false;
    let lines;

    try {
        lines = await fetchLog({ baseUrl, linesFrom, authToken, page, sort });
    } catch (err) {
        winston.error(err);
        throw err;
    }

    const linesCount = lines.length;
    const pagesToLoadUpdated = pagesToLoad - 1;
    const maxLinesUpdated = linesCount > MAX_LINES_SMALL ? MAX_LINES_BIG : maxLines;
    const linesFromUpdated = sort === 'descending' ?
        linesFrom - linesCount : linesCount + linesFrom;
    // If we got lines AND there are more lines to load
    const descLoadNext = sort === 'descending' && linesCount > 0 && linesFrom - linesCount > 0;
    // If we got lines AND we reached the edge of a page
    const ascLoadNext = sort === 'ascending' && linesCount > 0
        && (linesCount + linesFrom) % maxLines === 0;

    // Load from next log if there's still lines left
    if (ascLoadNext || descLoadNext) {
        if (pagesToLoadUpdated > 0) {
            const loadConfig = {
                baseUrl,
                linesFrom: linesFromUpdated,
                authToken,
                pagesToLoad: pagesToLoadUpdated,
                sort,
                maxLines: maxLinesUpdated
            };

            return loadLines(loadConfig)
                .then(([nextLines, pageLimit]) => {
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
    config: {
        description: 'Get the logs for a build step',
        notes: 'Returns the logs for a step',
        tags: ['api', 'builds', 'steps', 'log'],
        auth: {
            strategies: ['token'],
            scope: ['user', 'pipeline']
        },
        plugins: {
            'hapi-swagger': {
                security: [{ token: [] }]
            }
        },
        handler: (req, reply) => {
            const factory = req.server.app.buildFactory;
            const buildId = req.params.id;
            const stepName = req.params.name;
            const headers = req.headers;

            factory.get(buildId)
                .then((model) => {
                    if (!model) {
                        throw boom.notFound('Build does not exist');
                    }

                    const stepModel = model.steps.filter(step => (
                        step.name === stepName
                    )).pop();

                    if (!stepModel) {
                        throw boom.notFound('Step does not exist');
                    }

                    const isNotStarted = stepModel.startTime === undefined;
                    const output = [];

                    if (isNotStarted) {
                        return reply(output).header('X-More-Data', 'false');
                    }

                    const isDone = stepModel.code !== undefined;
                    const baseUrl = `${config.ecosystem.store}/v1/builds/`
                        + `${buildId}/${stepName}/log`;
                    const loadConfig = {
                        baseUrl,
                        linesFrom: req.query.from,
                        authToken: headers.authorization,
                        pagesToLoad: req.query.pages || 10,
                        sort: req.query.sort || 'ascending'
                    };

                    // eslint-disable-next-line max-len
                    return loadLines(loadConfig)
                        .then(([lines, morePages]) => reply(lines)
                            .header('X-More-Data', (morePages || !isDone).toString()));
                })
                .catch(err => reply(boom.wrap(err)));
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
