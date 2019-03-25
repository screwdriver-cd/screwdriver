'use strict';

const joi = require('joi');
const schema = require('screwdriver-data-schema');
const tinytim = require('tinytim');
const idSchema = joi.reach(schema.models.pipeline.base, 'id');

/**
 * Generate Badge URL
 * @method getUrl
 * @param  {string}  badgeService    Template URL for badges - needs {{status}} and {{color}}
 * @param  {Array}  [builds]         An array of builds
 * @return {string}                  URL to redirect to
 */
function getUrl(badgeService, builds = [], subject = 'job') {
    let color = 'lightgrey';
    let status = '';

    const statusColor = {
        success: 'green',
        queued: 'blue',
        running: 'blue',
        unknown: 'lightgrey',
        failure: 'red',
        aborted: 'red'
    };

    if (builds.length > 0) {
        status = builds[0].status.toLowerCase();
        color = statusColor[status];
    }

    return tinytim.tim(badgeService, {
        subject,
        status,
        color
    });
}

module.exports = () => ({
    method: 'GET',
    path: '/pipelines/{id}/{jobName}/badge',
    config: {
        description: 'Get a badge for a job',
        notes: 'Redirects to the badge service',
        tags: ['api', 'job', 'badge'],
        handler: (request, reply) => {
            const jobFactory = request.server.app.jobFactory;
            const { id, jobName } = request.params;
            const badgeService = request.server.app.ecosystem.badges;

            return jobFactory.get({
                pipelineId: id,
                name: jobName
            }).then((job) => {
                if (!job) {
                    return reply.redirect(getUrl(badgeService));
                }

                const config = {
                    paginate: {
                        page: 1,
                        count: 1
                    }
                };

                return job.getBuilds(config)
                    .then(builds => reply.redirect(getUrl(badgeService, builds, jobName)));
            }).catch(() => reply.redirect(getUrl(badgeService)));
        },
        validate: {
            params: {
                id: idSchema,
                jobName: joi.reach(schema.models.job.base, 'name')
            }
        }
    }
});
