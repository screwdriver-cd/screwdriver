'use strict';

const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const listSchema = joi.array().items(schema.models.pipeline.get).label('List of Pipelines');

module.exports = () => ({
    method: 'GET',
    path: '/pipelines',
    config: {
        description: 'Get pipelines with pagination',
        notes: 'Returns all pipeline records',
        tags: ['api', 'pipelines'],
        handler: (request, reply) => {
            const factory = request.server.app.pipelineFactory;
            const credentials = request.auth.credentials;
            const canAccess = request.server.plugins.pipelines.canAccess;
            const filtered = [];

            return factory.list({
                paginate: {
                    page: request.query.page,
                    count: request.query.count
                },
                sort: request.query.sort
            })
            .then(pipelines => Promise.all(pipelines.map(p => canAccess(credentials, p, 'pull')))
            .then((results) => {
                results.forEach((hasAccess, index) => {
                    if (hasAccess) {
                        filtered.push(pipelines[index]);
                    }
                });

                return reply(filtered.map(p => p.toJson()));
            }))
            .catch(err => reply(boom.wrap(err)));
        },
        response: {
            schema: listSchema
        },
        validate: {
            query: schema.api.pagination
        }
    }
});
