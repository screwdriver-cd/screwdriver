'use strict';

const boom = require('boom');
const schema = require('screwdriver-data-schema');
const request = require('request');
const ndjson = require('ndjson');
const MAX_LINES = 100;

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

                    const page = Math.floor(req.query.from / MAX_LINES);
                    const isDone = stepModel.code !== undefined;
                    const url = `${config.ecosystem.store}/v1/builds/`
                        + `${buildId}/${stepName}/log.${page}`;

                    return request
                        // Load NDJson from S3 bucket
                        .get(url)
                        .pipe(ndjson.parse({
                            strict: false
                        }))
                        // Parse until line request.query.from
                        .on('data', (line) => {
                            if (line.n >= req.query.from) {
                                output.push(line);
                            }
                        })
                        // Set header X-More-Data: false if lines < MAX_LINES && step done
                        .on('end', () =>
                            reply(output).header('X-More-Data',
                                (!(output.length < MAX_LINES && isDone)).toString()));
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
