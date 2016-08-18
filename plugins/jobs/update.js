/* eslint no-param-reassign: ["error", { "props": false }] */
'use strict';
const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const idSchema = joi.reach(schema.models.job.base, 'id');

module.exports = () => ({
    method: 'PUT',
    path: '/jobs/{id}',
    config: {
        description: 'Update a job',
        notes: 'Update a specific job',
        tags: ['api', 'jobs'],
        auth: {
            strategies: ['token', 'session'],
            scope: ['user']
        },
        handler: (request, reply) => {
            const factory = request.server.app.jobFactory;
            const id = request.params.id;

            return factory.get(id)
                .then(job => {
                    if (!job) {
                        throw boom.notFound(`Job ${id} does not exist`);
                    }

                    Object.keys(request.payload).forEach(key => {
                        job[key] = request.payload[key];
                    });

                    return job.update();
                })
                .then(job => reply(job.toJson()).code(200))
                .catch(err => reply(boom.wrap(err)));
        },
        validate: {
            params: {
                id: idSchema
            },
            payload: schema.models.job.update
        }
    }
});
