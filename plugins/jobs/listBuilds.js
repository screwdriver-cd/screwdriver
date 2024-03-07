'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const jobIdSchema = schema.models.job.base.extract('id');
const statusSchema = schema.models.build.base.extract('status');
const buildListSchema = joi.array().items(schema.models.build.get).label('List of builds');

module.exports = () => ({
    method: 'GET',
    path: '/jobs/{id}/builds',
    options: {
        description: 'Get builds for a given job',
        notes: 'Returns builds for a given job',
        tags: ['api', 'jobs', 'builds'],
        auth: {
            strategies: ['token'],
            scope: ['user', 'pipeline', 'build']
        },

        handler: async (request, h) => {
            const factory = request.server.app.jobFactory;
            const { sort, sortBy, page, count, fetchSteps, readOnly, status } = request.query;

            return factory
                .get(request.params.id)
                .then(job => {
                    if (!job) {
                        throw boom.notFound('Job does not exist');
                    }

                    const config = readOnly
                        ? { sort, sortBy: 'createTime', readOnly: true }
                        : { sort, sortBy: 'createTime' };

                    if (sortBy) {
                        config.sortBy = sortBy;
                    }

                    if (status) {
                        config.status = status;
                    }

                    if (page || count) {
                        config.paginate = { page, count };
                    }

                    return job.getBuilds(config);
                })
                .then(async builds => {
                    let data;

                    if (fetchSteps) {
                        data = await Promise.all(builds.map(b => b.toJsonWithSteps()));
                    } else {
                        data = await Promise.all(builds.map(b => b.toJson()));
                    }

                    return h.response(data);
                })
                .catch(err => {
                    throw err;
                });
        },
        response: {
            schema: buildListSchema
        },
        validate: {
            params: joi.object({
                id: jobIdSchema
            }),
            query: schema.api.pagination.concat(
                joi.object({
                    readOnly: joi.boolean().truthy('true').falsy('false').default(true),
                    fetchSteps: joi.boolean().truthy('true').falsy('false').default(true),
                    status: statusSchema,
                    search: joi.forbidden(), // we don't support search for Job list builds
                    getCount: joi.forbidden()
                })
            )
        }
    }
});
