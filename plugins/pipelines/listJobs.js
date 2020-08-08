'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const jobListSchema = joi
    .array()
    .items(schema.models.job.get)
    .label('List of jobs');
const jobNameSchema = schema.models.job.base.extract('name');
const pipelineIdSchema = schema.models.pipeline.base.extract('id');

module.exports = () => ({
    method: 'GET',
    path: '/pipelines/{id}/jobs',
    config: {
        description: 'Get all jobs for a given pipeline',
        notes: 'Returns all jobs for a given pipeline',
        tags: ['api', 'pipelines', 'jobs'],
        auth: {
            strategies: ['token'],
            scope: ['user', 'build', 'pipeline']
        },
        plugins: {
            'hapi-swagger': {
                security: [{ token: [] }]
            }
        },
        handler: (request, h) => {
            const { pipelineFactory } = request.server.app;
            const { page, count, jobName } = request.query;

            return pipelineFactory
                .get(request.params.id)
                .then(pipeline => {
                    if (!pipeline) {
                        throw boom.notFound('Pipeline does not exist');
                    }

                    const config = {
                        params: {
                            archived: request.query.archived
                        }
                    };

                    if (jobName) {
                        config.params.name = jobName;
                    }
                    if (page || count) {
                        config.paginate = { page, count };
                    }

                    return pipeline.getJobs(config);
                })
                .then(jobs => h.response(jobs.map(j => j.toJson())))
                .catch(err => h.response(boom.boomify(err)));
        },
        response: {
            schema: jobListSchema
        },
        validate: {
            params: joi.object({
                id: pipelineIdSchema
            }),
            query: schema.api.pagination.concat(
                joi.object({
                    archived: joi
                        .boolean()
                        .truthy('true')
                        .falsy('false')
                        .default(false),
                    jobName: jobNameSchema
                })
            )
        }
    }
});
