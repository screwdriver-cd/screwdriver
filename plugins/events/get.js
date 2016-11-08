'use strict';

const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const getSchema = schema.models.event.get;
const idSchema = joi.reach(schema.models.event.base, 'id');

module.exports = () => ({
    method: 'GET',
    path: '/events/{id}',
    config: {
        description: 'Get a single event',
        notes: 'Returns a event record',
        tags: ['api', 'events'],
        handler: (request, reply) => {
            const factory = request.server.app.eventFactory;

            return factory.get(request.params.id)
                .then((model) => {
                    if (!model) {
                        throw boom.notFound('Event does not exist');
                    }

                    return reply(model.toJson());
                })
                .catch(err => reply(boom.wrap(err)));
        },
        response: {
            schema: getSchema
        },
        validate: {
            params: {
                id: idSchema
            }
        }
    }
});
