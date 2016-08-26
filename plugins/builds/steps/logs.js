'use strict';
const boom = require('boom');
const schema = require('screwdriver-data-schema');
const request = require('request');
const ndjson = require('ndjson');

module.exports = (config) => ({
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
                .then(model => {
                    if (!model) {
                        throw boom.notFound('Build does not exist');
                    }

                    const stepModel = model.steps.filter((step) => (
                        step.name === stepName
                    )).pop();

                    if (!stepModel) {
                        throw boom.notFound('Step does not exist');
                    }

                    const isNotDone = stepModel.code === undefined;
                    const url = `${config.logBaseUrl}/${buildId}/${stepName}`;
                    const output = [];

                    request
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
                        // Set header X-More-Data: true if step not done
                        .on('end', () =>
                            reply(output).header('X-More-Data', isNotDone.toString()));
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
