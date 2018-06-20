'use strict';

const boom = require('boom');
const schema = require('screwdriver-data-schema');
const request = require('request');
const ndjson = require('ndjson');
const MAX_LINES = 1000;

/**
 * Load up to N pages that are available
 * @method loadLines
 * @param  {String}     baseUrl          URL to load from (without the .$PAGE)
 * @param  {Integer}    linesFrom        What line number are we starting from
 * @param  {String}     authToken        Bearer Token to be passed to the store
 * @param  {Integer}    [pagesToLoad=10] Number of pages left to load
 * @return {Promise}                     [Array of log lines, Are there more pages]
 */
function loadLines(baseUrl, linesFrom, authToken, pagesToLoad = 10) {
    return new Promise((resolve) => {
        const page = Math.floor(linesFrom / MAX_LINES);
        const output = [];

        request
            .get({
                url: `${baseUrl}.${page}`,
                headers: {
                    Authorization: authToken
                }
            })
            // Parse the ndjson
            .pipe(ndjson.parse({
                strict: false
            }))
            // Filter down to the lines we care about
            .on('data', (line) => {
                if (line.n >= linesFrom) {
                    output.push(line);
                }
            })
            .on('end', () => resolve(output));
    }).then((lines) => {
        const linesCount = lines.length;
        const pagesToLoadUpdated = pagesToLoad - 1;
        let morePages = false;

        // Load from next log if we got lines AND we reached the edge of a page
        if (linesCount > 0 && (linesCount + linesFrom) % MAX_LINES === 0) {
            if (pagesToLoadUpdated > 0) {
                return loadLines(baseUrl, linesCount + linesFrom, authToken, pagesToLoadUpdated)
                    .then(([nextLines, pageLimit]) => [lines.concat(nextLines), pageLimit]);
            }
            // Otherwise exit early and flag that there may be more pages
            morePages = true;
        }

        return [lines, morePages];
    });
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
            scope: ['user']
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

                    // eslint-disable-next-line max-len
                    return loadLines(baseUrl, req.query.from, headers.authorization, req.query.pages)
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
