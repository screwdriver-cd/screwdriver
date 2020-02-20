'use strict';

const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const idSchema = joi.reach(schema.models.job.base, 'id');
const statusSchema = joi.reach(schema.models.build.base, 'status');

module.exports = () => ({
    method: 'GET',
    path: '/jobs/{id}/latestBuild',
    config: {
        description: 'Get latest build for a given job',
        notes: 'Return latest build of status specified',
        tags: ['api', 'job', 'build'],
        auth: {
            strategies: ['token'],
            scope: ['user', 'build', 'pipeline']
        },
        plugins: {
            'hapi-swagger': {
                security: [{ token: [] }]
            }
        },
        handler: (request, reply) => {
            const jobFactory = request.server.app.jobFactory;
            const { status } = request.query || {};

            return jobFactory.get(request.params.id)
                .then((job) => {
                    if (!job) {
                        throw boom.notFound('Job does not exist');
                    }

                    return job.getLatestBuild({ status });
                })
                .then((build) => {
                    if (Object.keys(build).length === 0) {
                        throw boom.notFound('There is no such latest build');
                    }

                    return reply(build.toJsonWithSteps());
                })
                .catch(err => reply(boom.boomify(err)));
        },
        response: {
            schema: joi.object()
        },
        validate: {
            params: {
                id: idSchema
            },
            query: {
                status: statusSchema
            }
        }
    }
});
