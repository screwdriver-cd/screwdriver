'use strict';
const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const idSchema = joi.reach(schema.models.job.base, 'id');
const Model = require('screwdriver-models');

module.exports = (datastore) => ({
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
            const Job = new Model.Job(datastore);
            const id = request.params.id;
            const config = {
                id,
                data: request.payload
            };

            Job.update(config, (err, response) => {
                if (err) {
                    return reply(boom.wrap(err));
                }

                if (!response) {
                    return reply(boom.notFound(`Job ${id} does not exist`));
                }

                return reply(response).code(200);
            });
        },
        validate: {
            params: {
                id: idSchema
            },
            payload: schema.models.job.update
        }
    }
});
