'use strict';
const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const idSchema = joi.reach(schema.models.build.base, 'id');

module.exports = (server) => ({
    method: 'GET',
    path: '/builds/{id}/logs',
    config: {
        description: 'Get logs for a build',
        notes: 'Streams logs',
        tags: ['api', 'builds'],
        auth: {
            strategies: ['token', 'session'],
            scope: ['user']
        },
        handler: (request, reply) => {
            const factory = server.settings.app.buildFactory;
            const id = request.params.id;

            return factory.get(id)
                .then(build => {
                    if (!build) {
                        throw boom.notFound(`Build ${id} does not exist.`);
                    }

                    return build.stream();
                })
                .then(reply)
                .catch(err => reply(boom.wrap(err)));
        },
        validate: {
            params: {
                id: idSchema
            }
        }
    }
});
