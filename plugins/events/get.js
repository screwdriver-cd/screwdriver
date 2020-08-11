'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const getSchema = schema.models.event.get;
const idSchema = schema.models.event.base.extract('id');

module.exports = () => ({
    method: 'GET',
    path: '/events/{id}',
    options: {
        description: 'Get a single event',
        notes: 'Returns a event record',
        tags: ['api', 'events'],
        auth: {
            strategies: ['token'],
            scope: ['user', 'build', 'pipeline']
        },
        plugins: {
            'hapi-swagger': {
                security: [{ token: [] }]
            }
        },
        handler: async (request, h) => {
            const factory = request.server.app.eventFactory;

            return factory
                .get(request.params.id)
                .then(model => {
                    if (!model) {
                        throw boom.notFound('Event does not exist');
                    }

                    return h.response(model.toJson());
                })
                .catch(err => {
                    throw err;
                });
        },
        response: {
            schema: getSchema
        },
        validate: {
            params: joi.object({
                id: idSchema
            })
        }
    }
});
