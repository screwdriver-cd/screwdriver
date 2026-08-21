'use strict';

const joi = require('joi');
const schema = require('screwdriver-data-schema');
const idSchema = schema.models.pipeline.base.extract('id');
const logger = require('screwdriver-logger');
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
            const contentType = 'image/svg+xml;charset=utf-8';
            let label;

            try {
                const [job, pipeline] = await Promise.all([
                    jobFactory.get({
                        pipelineId: id,
                        name: jobName
                    }),
                    pipelineFactory.get(id)
                ]);

                if (!pipeline) {
                    return h.response(getJobBadge({ statusColor })).header('Content-Type', contentType);
                }

                label = pipeline.name;

                if (!job) {
                    return h.response(getJobBadge({ statusColor, label })).header('Content-Type', contentType);
                }

                label = `${pipeline.name}:${jobName}`;

                if (job.state === 'DISABLED') {
                    return h
                        .response(
                            getJobBadge({
                                statusColor,
                                label,
                                builds: [{ status: 'DISABLED' }]
                            })
                        )
                        .header('Content-Type', contentType);
                }

                const builds = await job.getBuilds({
                    paginate: {
                        page: 1,
                        count: 1
                    }
                });

                return h.response(getJobBadge({ statusColor, label, builds })).header('Content-Type', contentType);
            } catch (err) {
                logger.error(`Failed to get job badge for pipeline:${id}, job:${jobName}: ${err.message}`);

                return h.response(getJobBadge({ statusColor, label })).header('Content-Type', contentType);
            }
        },
        validate: {
            params: joi.object({
                id: idSchema,
                jobName: schema.models.job.base.extract('name')
            })
        }
    }
});
