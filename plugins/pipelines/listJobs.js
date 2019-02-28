'use strict';

const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const listSchema = joi.array().items(schema.models.job.get).label('List of jobs');

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
        handler: (request, reply) => {
            const pipelineFactory = request.server.app.pipelineFactory;
            const { page, count, jobName } = request.query;

            return pipelineFactory.get(request.params.id)
                .then((pipeline) => {
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
                .then(jobs => reply(jobs.map(j => j.toJson())))
                .catch(err => reply(boom.boomify(err)));
        },
        response: {
            schema: listSchema
        },
        validate: {
            query: schema.api.pagination.concat(joi.object({
                archived: joi.boolean().truthy('true').falsy('false').default(false),
                jobName: joi.reach(schema.models.job.base, 'name')
            }))
        }
    }
});
