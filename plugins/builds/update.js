/* eslint no-param-reassign: ["error", { "props": false }] */
'use strict';
const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const idSchema = joi.reach(schema.models.job.base, 'id');

module.exports = () => ({
    method: 'PUT',
    path: '/builds/{id}',
    config: {
        description: 'Save a build',
        notes: 'Save a specific build',
        tags: ['api', 'builds'],
        auth: {
            strategies: ['token', 'session'],
            scope: ['user']
        },
        handler: (request, reply) => {
            const factory = request.server.app.buildFactory;
            const id = request.params.id;

            return factory.get(id)
                .then(build => {
                    if (!build) {
                        throw boom.notFound(`Build ${id} does not exist`);
                    }

                    Object.keys(request.payload).forEach(key => {
                        build[key] = request.payload[key];
                    });

                    return build.update();
                })
                .then(build => reply(build.toJson()).code(200))
                .catch(err => reply(boom.wrap(err)));
        },
        validate: {
            params: {
                id: idSchema
            },
            payload: schema.models.build.update
        }
    }
});
