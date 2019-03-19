'use strict';

const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const listSchema = joi.array().items(schema.models.event.get).label('List of events');

module.exports = () => ({
    method: 'GET',
    path: '/pipelines/{id}/events',
    config: {
        description: 'Get pipeline type events for this pipeline',
        notes: 'Returns pipeline events for the given pipeline',
        tags: ['api', 'pipelines', 'events'],
        auth: {
            strategies: ['token'],
            scope: ['user', 'build', 'pipeline']
        },
        plugins: {
            'hapi-swagger': {
                security: [{ token: [] }]
            }
        },
        handler: (request, reply) => {
            const factory = request.server.app.pipelineFactory;

            return factory.get(request.params.id)
                .then((pipeline) => {
                    if (!pipeline) {
                        throw boom.notFound('Pipeline does not exist');
                    }

                    const eventType = request.query.type || 'pipeline';
                    const config = { params: { type: eventType } };

                    if (request.query.page || request.query.count) {
                        config.paginate = {
                            page: request.query.page,
                            count: request.query.count
                        };
                    }

                    if (request.query.prNum) {
                        config.params.type = 'pr';
                        config.params.prNum = request.query.prNum;
                    }

                    return pipeline.getEvents(config);
                })
                .then(events => reply(events.map(e => e.toJson())))
                .catch(err => reply(boom.boomify(err)));
        },
        response: {
            schema: listSchema
        },
        validate: {
            query: schema.api.pagination.concat(joi.object({
                type: joi.string(),
                prNum: joi.reach(schema.models.event.base, 'prNum')
            }))
        }
    }
});
