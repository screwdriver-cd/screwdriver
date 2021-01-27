'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const getSchema = schema.models.job.get;
const idSchema = schema.models.job.base.extract('id');

module.exports = () => ({
    method: 'GET',
    path: '/jobs/{id}',
    options: {
        description: 'Get a single job',
        notes: 'Returns a job record',
        tags: ['api', 'jobs'],
        auth: {
            strategies: ['token'],
            scope: ['user', 'build', 'pipeline']
        },

        handler: async (request, h) => {
            const factory = request.server.app.jobFactory;

            return factory
                .get(request.params.id)
                .then(job => {
                    if (!job) {
                        throw boom.notFound('Job does not exist');
                    }

                    return h.response(job.toJson());
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
