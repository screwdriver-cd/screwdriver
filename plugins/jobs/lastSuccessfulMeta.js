'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const idSchema = schema.models.job.base.extract('id');

module.exports = () => ({
    method: 'GET',
    path: '/jobs/{id}/lastSuccessfulMeta',
    options: {
        description: 'Get the last successful metadata for a given job',
        notes: 'If no successful builds found in the past 50 builds, will return {}',
        tags: ['api', 'jobs', 'builds'],
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

                    return job.getBuilds({
                        status: 'SUCCESS'
                    });
                })
                .then(builds => {
                    const meta = builds[0] ? builds[0].meta : {};

                    return h.response(meta);
                })
                .catch(err => {
                    throw err;
                });
        },
        response: {
            schema: joi.object()
        },
        validate: {
            params: joi.object({
                id: idSchema
            })
        }
    }
});
