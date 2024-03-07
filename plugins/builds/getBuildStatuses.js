'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const stringSchema = joi.string().regex(/^[0-9]+$/);
const jobIdsSchema = joi.alternatives().try(joi.array().items(stringSchema), stringSchema).example(123345).required();

module.exports = () => ({
    method: 'GET',
    path: '/builds/statuses',
    options: {
        description: 'Get build statuses for jobs',
        notes: 'Returns id, jobId, and status for builds',
        tags: ['api', 'builds'],
        auth: {
            strategies: ['token'],
            scope: ['user', 'build', 'pipeline']
        },

        handler: async (request, h) => {
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

                    return h.response(builds);
                })
                .catch(err => {
                    throw err;
                });
        },
        response: {
            schema: joi.array()
        },
        validate: {
            query: joi.object({
                jobIds: jobIdsSchema,
                numBuilds: joi.number().integer().positive().default(1),
                offset: joi.number().integer().min(0).default(0)
            })
        }
    }
});
