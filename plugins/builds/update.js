'use strict';
const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const idSchema = joi.reach(schema.models.job.base, 'id');
const Model = require('screwdriver-models');

module.exports = (datastore, executor) => ({
    method: 'PUT',
    path: '/builds/{id}',
    config: {
        description: 'Save a build',
        notes: 'Save a specific build',
        tags: ['api', 'builds'],
        auth: {
            strategies: ['token', 'session']
        },
        handler: (request, reply) => {
            const Build = new Model.Build(datastore, executor);

            const id = request.params.id;

            const config = {
                id,
                data: request.payload
            };

            Build.update(config, (err, data) => {
                if (err) {
                    return reply(boom.wrap(err));
                }

                if (!data) {
                    return reply(boom.notFound(`Build ${id} does not exist`));
                }

                return reply(data).code(200);
            });
        },
        validate: {
            params: {
                id: idSchema
            },
            payload: schema.models.build.update
        }
    }
});
