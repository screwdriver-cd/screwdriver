'use strict';

const joi = require('joi');
const schema = require('screwdriver-data-schema');
const tinytim = require('tinytim');
const idSchema = joi.reach(schema.models.pipeline.base, 'id');

/**
 * Generate Badge URL
 * @method getUrl
 * @param  {string}  badgeService    Template URL for badges - needs {{status}} and {{color}}
 * @param  {string}  [currentStatus] Current Build Status
 * @return {string}                  URL to redirect to
 */
function getUrl(badgeService, currentStatus) {
    const status = (currentStatus || 'UNKNOWN').toLowerCase();
    const statusColor = {
        unknown: 'lightgrey',
        success: 'green',
        failure: 'red',
        aborted: 'red',
        queued: 'blue',
        running: 'blue'
    };
    const color = statusColor[status];

    return tinytim.tim(badgeService, {
        status, color
    });
}

module.exports = () => ({
    method: 'GET',
    path: '/pipelines/{id}/badge',
    config: {
        description: 'Get a badge for the pipeline',
        notes: 'Redirects to the badge service',
        tags: ['api', 'pipelines', 'badge'],
        handler: (request, reply) => {
            const factory = request.server.app.pipelineFactory;
            const badgeService = request.server.app.ecosystem.badges;

            return factory.get(request.params.id)
                .then((pipeline) => {
                    if (!pipeline) {
                        return reply.redirect(getUrl(request.server.app.ecosystem.badges));
                    }

                    return pipeline.getEvents({ sort: 'ascending' }).then((events) => {
                        const lastEvent = events.pop();

                        if (!lastEvent) {
                            return reply.redirect(getUrl(badgeService));
                        }

                        return lastEvent.getBuilds().then((builds) => {
                            const build = builds.reverse().pop();

                            return reply.redirect(getUrl(badgeService, build && build.status));
                        });
                    });
                })
                .catch(() => reply.redirect(getUrl(badgeService)));
        },
        validate: {
            params: {
                id: idSchema
            }
        }
    }
});
