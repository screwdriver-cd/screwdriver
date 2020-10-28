'use strict';

const joi = require('joi');
const schema = require('screwdriver-data-schema');
const tinytim = require('tinytim');
const idSchema = schema.models.pipeline.base.extract('id');

/**
 * Generate Badge URL
 * @method getUrl
 * @param  {String} badgeService            Badge service url
 * @param  {Object} statusColor             Mapping for status and color
 * @param  {Function} encodeBadgeSubject    Function to encode subject
 * @param  {Array}  [builds=[]]             An array of builds
 * @param  {String} [subject='job']         Subject of the badge
 * @return {String}
 */
function getUrl({ badgeService, statusColor, encodeBadgeSubject, builds = [], subject = 'job' }) {
    let color = 'lightgrey';
    let status = 'unknown';

    if (builds.length > 0) {
        status = builds[0].status.toLowerCase();
        color = statusColor[status];
    }

    return tinytim.tim(badgeService, {
        subject: encodeBadgeSubject({ badgeService, subject }),
        status,
        color
    });
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
            const badgeService = request.server.app.ecosystem.badges;
            const { encodeBadgeSubject } = request.server.plugins.pipelines;
            const { statusColor } = config;
            const badgeConfig = {
                badgeService,
                statusColor,
                encodeBadgeSubject
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
                        return h.redirect(getUrl(badgeConfig));
                    }

                    if (job.state === 'DISABLED') {
                        return h.redirect(
                            getUrl(
                                Object.assign(badgeConfig, {
                                    builds: [
                                        {
                                            status: 'DISABLED'
                                        }
                                    ],
                                    subject: `${pipeline.name}:${jobName}`
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

                    return job.getBuilds(listConfig).then(builds =>
                        h.redirect(
                            getUrl(
                                Object.assign(badgeConfig, {
                                    builds,
                                    subject: `${pipeline.name}:${jobName}`
                                })
                            )
                        )
                    );
                })
                .catch(() => h.redirect(getUrl(badgeConfig)));
        },
        validate: {
            params: joi.object({
                id: idSchema,
                jobName: schema.models.job.base.extract('name')
            })
        }
    }
});
