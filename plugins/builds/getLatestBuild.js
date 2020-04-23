'use strict';

const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const buildSchema = schema.models.build.get;
const jobIdSchema = joi.string().regex(/^[0-9]+$/);
const statusSchema = joi.reach(schema.models.build.base, 'status');

module.exports = () => ({
    method: 'GET',
    path: '/builds/latest',
    config: {
        description: 'Get latest build for job',
        notes: 'Returns latest build for job, possibly restricted to builds with specific status',
        tags: ['api', 'builds'],
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
            const { buildFactory } = request.server.app;
            const { jobId, status } = request.query;

            const listConfig = {
                params: {
                    jobId
                }
            };

            if (status) {
                listConfig.params.status = status;
            }

            return buildFactory
                .list(listConfig)
                .then(builds => {
                    if (builds.length === 0) {
                        throw boom.notFound('Build does not exist');
                    }

                    reply(builds[0]);
                })
                .catch(err => reply(boom.boomify(err)));
        },
        response: {
            schema: buildSchema
        },
        validate: {
            query: {
                jobId: jobIdSchema,
                status: statusSchema
            }
        }
    }
});
