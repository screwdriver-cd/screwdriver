'use strict';
const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const getSchema = schema.models.build.get;
const idSchema = joi.reach(schema.models.build.base, 'id');

module.exports = () => ({
    method: 'GET',
    path: '/builds/{id}',
    config: {
        description: 'Get a single build',
        notes: 'Returns a build record',
        tags: ['api', 'builds'],
        handler: (request, reply) => {
            const factory = request.server.app.buildFactory;

            factory.get(request.params.id)
                .then(model => {
                    if (!model) {
                        throw boom.notFound('Build does not exist');
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
