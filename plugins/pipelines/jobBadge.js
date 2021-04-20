'use strict';

const joi = require('joi');
const schema = require('screwdriver-data-schema');
const idSchema = schema.models.pipeline.base.extract('id');
const { makeBadge } = require('badge-maker');

/**
 * Generate Badge Format
 * @method getLabels
 * @param  {Object} statusColor             Mapping for status and color
 * @param  {Array}  [builds=[]]       An array of builds
 * @param  {String} [label='job']         Subject of the badge
 * @return {Object}
 */
function getLabels({ statusColor, builds = [], label = 'job' }) {
    let color = 'lightgrey';
    let status = 'unknown';

    if (builds.length > 0) {
        status = builds[0].status.toLowerCase();
        color = statusColor[status];
    }

    return {
        label,
        message: status,
        color
    };
}

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

            const getBadge = badgeObject => {
                const labels = getLabels(badgeObject);

                return makeBadge(labels);
            };

            return Promise.all([
                jobFactory.get({
                    pipelineId: id,
                    name: jobName
                }),
                pipelineFactory.get(id)
            ])
                .then(([job, pipeline]) => {
                    if (!job) {
                        return h.response(getBadge(badgeConfig));
                    }

                    if (job.state === 'DISABLED') {
                        return h.response(
                            getBadge(
                                Object.assign(badgeConfig, {
                                    builds: [
                                        {
                                            status: 'DISABLED'
                                        }
                                    ],
                                    label: `${pipeline.name}:${jobName}`
                                })
                            )
                        );
                    }

                    const listConfig = {
                        paginate: {
                            page: 1,
                            count: 1
                        }
                    };

                    return job.getBuilds(listConfig).then(builds => {
                        return h.response(
                            getBadge(
                                Object.assign(badgeConfig, {
                                    builds,
                                    label: `${pipeline.name}:${jobName}`
                                })
                            )
                        );
                    });
                })
                .catch(() => h.response(getBadge(badgeConfig)));
        },
        validate: {
            params: joi.object({
                id: idSchema,
                jobName: schema.models.job.base.extract('name')
            })
        }
    }
});
