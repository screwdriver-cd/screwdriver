'use strict';

const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const idSchema = joi.reach(schema.models.job.base, 'id');
const positionSchema = joi.string().description('position in relative to latestBuild');
const statusSchema = joi.reach(schema.models.build.base, 'status');

module.exports = () => ({
    method: 'GET',
    path: '/jobs/{id}/{position}',
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
            const { position, id } = request.params;

            return jobFactory.get(id)
                .then((job) => {
                    if (!job) {
                        throw boom.notFound('Job does not exist');
                    }

                    return job.getLatestBuild({ position, status });
                })
                .then((build) => {
                    if (Object.keys(build).length === 0) {
                        throw boom.notFound('There is no such build');
                    }

                    return reply(build.toJson());
                })
                .catch(err => reply(boom.boomify(err)));
        },
        response: {
            schema: joi.object()
        },
        validate: {
            params: {
                id: idSchema,
                position: positionSchema
            },
            query: {
                status: statusSchema
            }
        }
    }
});
