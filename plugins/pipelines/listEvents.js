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
        handler: (request, reply) => {
            const factory = request.server.app.pipelineFactory;

            return factory.get(request.params.id)
                .then((pipeline) => {
                    if (!pipeline) {
                        throw boom.notFound('Pipeline does not exist');
                    }

                    return pipeline.getEvents();
                })
                .then(events => reply(events.map(e => e.toJson())))
                .catch(err => reply(boom.wrap(err)));
        },
        response: {
            schema: listSchema
        }
    }
});
