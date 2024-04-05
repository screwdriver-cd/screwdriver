'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const jobListSchema = joi.array().items(schema.models.job.get).label('List of jobs');
const jobNameSchema = schema.models.job.base.extract('name');
const pipelineIdSchema = schema.models.pipeline.base.extract('id');
const JOB_PR_PATTERN = `PR-%:%`;

module.exports = () => ({
    method: 'GET',
    path: '/pipelines/{id}/jobs',
    options: {
        description: 'Get all jobs for a given pipeline',
        notes: 'Returns all jobs for a given pipeline',
        tags: ['api', 'pipelines', 'jobs'],
        auth: {
            strategies: ['token'],
            scope: ['user', 'build', 'pipeline']
        },

        handler: async (request, h) => {
            const { pipelineFactory } = request.server.app;
            const { page, count, jobName, type } = request.query;

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

                    if (type) {
                        config.search = {
                            field: 'name',
                            // Do a search for PR-%:% in job name
                            // See https://www.w3schools.com/sql/sql_like.asp for syntax
                            keyword: JOB_PR_PATTERN
                        };

                        if (type === 'pipeline') {
                            // Do a search for job name without PR-%:% pattern
                            // See https://www.w3schools.com/sql/sql_not.asp for syntax
                            config.search.inverse = true;
                        }
                    }
                    if (jobName) {
                        config.params.name = jobName;
                    }
                    if (page || count) {
                        config.paginate = { page, count };
                    }

                    return pipeline.getJobs(config);
                })
                .then(jobs => h.response(jobs.map(j => j.toJson())))
                .catch(err => {
                    throw err;
                });
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
                    type: joi.string().valid('', 'pr', 'pipeline').label('Job type filter (pr or pipeline)').optional(),
                    archived: joi.boolean().truthy('true').falsy('false').default(false),
                    jobName: jobNameSchema,
                    search: joi.forbidden(), // we don't support search for Pipeline list jobs
                    getCount: joi.forbidden(),
                    sortBy: joi.forbidden()
                })
            )
        }
    }
});
