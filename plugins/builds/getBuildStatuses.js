'use strict';

const boom = require('boom');
const joi = require('joi');
const stringSchema = joi.string().regex(/^[0-9]+$/);
const jobIdsSchema = joi.alternatives().try(joi.array().items(stringSchema), stringSchema);

module.exports = () => ({
    method: 'GET',
    path: '/builds/statuses',
    config: {
        description: 'Get build statuses for jobs',
        notes: 'Returns id, jobId, and status for builds',
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
            const { jobIds, numBuilds, offset } = request.query;

            const payload = {
                jobIds: [].concat(jobIds).map(jobId => parseInt(jobId, 10)),
                numBuilds: parseInt(numBuilds, 10),
                offset: parseInt(offset, 10)
            };

            return buildFactory
                .getBuildStatuses(payload)
                .then(builds => {
                    if (builds.length === 0) {
                        throw boom.notFound('Builds do not exist');
                    }

                    reply(builds);
                })
                .catch(err => reply(boom.boomify(err)));
        },
        response: {
            schema: joi.array()
        },
        validate: {
            query: {
                jobIds: jobIdsSchema,
                numBuilds: stringSchema,
                offset: stringSchema
            }
        }
    }
});
