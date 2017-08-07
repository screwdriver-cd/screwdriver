'use strict';

const boom = require('boom');
const schema = require('screwdriver-data-schema');
const request = require('request');
const ndjson = require('ndjson');
const MAX_LINES = 100;
const MAX_PAGES = 10;

/**
 * Load up to N pages that are available
 * @method loadLines
 * @param  {String}     baseUrl         URL to load from (without the .$PAGE)
 * @param  {Integer}    linesFrom       What line number are we starting from
 * @param  {Integer}    [pagesLoaded=0] How many pages have we loaded so far
 * @return {Promise}                    [Array of log lines, Are there more pages]
 */
function loadLines(baseUrl, linesFrom, pagesLoaded = 0) {
    return new Promise((resolve) => {
        const page = Math.floor(linesFrom / MAX_LINES);
        const output = [];

        request
            .get(`${baseUrl}.${page}`)
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
        const currentPage = pagesLoaded + 1;
        let morePages = false;

        // Load from next log if we got lines AND we reached the edge of a page
        if (linesCount > 0 && (linesCount + linesFrom) % MAX_LINES === 0) {
            // If we haven't loaded MAX_PAGES, load the next page
            if (currentPage < MAX_PAGES) {
                return loadLines(baseUrl, linesCount + linesFrom, currentPage)
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
        handler: (req, reply) => {
            const factory = req.server.app.buildFactory;
            const buildId = req.params.id;
            const stepName = req.params.name;

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

                    return loadLines(baseUrl, req.query.from)
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
