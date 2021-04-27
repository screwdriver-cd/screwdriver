'use strict';

const joi = require('joi');
const schema = require('screwdriver-data-schema');
const idSchema = schema.models.pipeline.base.extract('id');
const { getJobBadge } = require('./helper');

module.exports = config => ({
    method: 'GET',
    path: '/pipelines/{id}/{jobName}/badge',
    options: {
        description: 'Get a badge for a job',
        notes: 'Redirects to the badge service',
        tags: ['api', 'job', 'badge'],
        plugins: {
            'hapi-rate-limit': {
                enabled: false
            }
        },
        handler: async (request, h) => {
            const { jobFactory } = request.server.app;
            const { pipelineFactory } = request.server.app;
            const { id, jobName } = request.params;
            const { statusColor } = config;
            const badgeConfig = {
                statusColor
            };
            const contentType = 'image/svg+xml;charset=utf-8';

            return Promise.all([
                jobFactory.get({
                    pipelineId: id,
                    name: jobName
                }),
                pipelineFactory.get(id)
            ])
                .then(([job, pipeline]) => {
                    if (!job) {
                        return h.response(getJobBadge(badgeConfig)).header('Content-Type', contentType);
                    }

                    if (job.state === 'DISABLED') {
                        return h
                            .response(
                                getJobBadge(
                                    Object.assign(badgeConfig, {
                                        builds: [
                                            {
                                                status: 'DISABLED'
                                            }
                                        ],
                                        label: `${pipeline.name}:${jobName}`
                                    })
                                )
                            )
                            .header('Content-Type', contentType);
                    }

                    const listConfig = {
                        paginate: {
                            page: 1,
                            count: 1
                        }
                    };

                    return job.getBuilds(listConfig).then(builds => {
                        return h
                            .response(
                                getJobBadge(
                                    Object.assign(badgeConfig, {
                                        builds,
                                        label: `${pipeline.name}:${jobName}`
                                    })
                                )
                            )
                            .header('Content-Type', contentType);
                    });
                })
                .catch(() => h.response(getJobBadge(badgeConfig)));
        },
        validate: {
            params: joi.object({
                id: idSchema,
                jobName: schema.models.job.base.extract('name')
            })
        }
    }
});
