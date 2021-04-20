'use strict';

const joi = require('joi');
const schema = require('screwdriver-data-schema');
const workflowParser = require('screwdriver-workflow-parser');
const idSchema = schema.models.pipeline.base.extract('id');
const { makeBadge } = require('badge-maker');

/**
 * Generate Badge Format
 * @method getLabels
 * @param  {Object} statusColor             Mapping for status and color
 * @param  {Array}  [buildsStatus=[]]       An array of builds
 * @param  {String} [label='pipeline']         Subject of the badge
 * @return {Object}
 */
function getLabels({ statusColor, buildsStatus = [], label = 'pipeline' }) {
    const counts = {};
    const parts = [];
    let worst = 'lightgrey';

    const levels = Object.keys(statusColor);

    buildsStatus.forEach(status => {
        counts[status] = (counts[status] || 0) + 1;
    });

    levels.forEach(status => {
        if (counts[status]) {
            parts.push(`${counts[status]} ${status}`);
            worst = statusColor[status];
        }
    });

    return {
        label,
        message: parts.length > 0 ? parts.join(', ') : 'unknown',
        color: worst
    };
}
/**
 * DFS the workflowGraph from the start point
 * @method dfs
 * @param  {Object} workflowGraph   workflowGraph
 * @param  {String} start           Start job name
 * @param  {String} prNum           PR number in case of PR trigger
 * @return {Set}                    A set of build ids that are visited
 */
function dfs(workflowGraph, start, prNum) {
    let nextJobsConfig;

    if (start === '~pr') {
        nextJobsConfig = {
            trigger: start,
            prNum
        };
    } else {
        nextJobsConfig = {
            trigger: start
        };
    }

    const nextJobs = workflowParser.getNextJobs(workflowGraph, nextJobsConfig);

    let visited = new Set(nextJobs);

    nextJobs.forEach(job => {
        const subJobs = dfs(workflowGraph, job);

        visited = new Set([...visited, ...subJobs]);
    });

    return visited;
}

module.exports = config => ({
    method: 'GET',
    path: '/pipelines/{id}/badge',
    options: {
        description: 'Get a badge for the pipeline',
        notes: 'Redirects to the badge service',
        tags: ['api', 'pipelines', 'badge'],
        plugins: {
            'hapi-rate-limit': {
                enabled: false
            }
        },
        handler: async (request, h) => {
            const factory = request.server.app.pipelineFactory;

            const { statusColor } = config;
            const badgeConfig = {
                statusColor
            };

            const getBadge = badgeObject => {
                const labels = getLabels(badgeObject);

                return makeBadge(labels);
            };

            return factory
                .get(request.params.id)
                .then(pipeline => {
                    if (!pipeline) {
                        return h.response(getBadge(badgeConfig));
                    }

                    return pipeline.getEvents({ sort: 'ascending' }).then(allEvents => {
                        const getLastEffectiveEvent = events => {
                            const lastEvent = events.pop();

                            if (!lastEvent) {
                                return h.response(getBadge(badgeConfig));
                            }

                            return lastEvent.getBuilds().then(builds => {
                                if (!builds || builds.length < 1) {
                                    return getLastEffectiveEvent(events);
                                }

                                const buildsStatus = builds.reverse().map(build => build.status.toLowerCase());

                                let workflowLength = 0;

                                if (lastEvent.workflowGraph) {
                                    const nextJobs = dfs(lastEvent.workflowGraph, lastEvent.startFrom, lastEvent.prNum);

                                    workflowLength = nextJobs.size;
                                }

                                for (let i = builds.length; i < workflowLength; i += 1) {
                                    buildsStatus[i] = 'unknown';
                                }

                                return h.response(
                                    getBadge(
                                        Object.assign(badgeConfig, {
                                            buildsStatus,
                                            label: pipeline.name
                                        })
                                    )
                                );
                            });
                        };

                        return getLastEffectiveEvent(allEvents);
                    });
                })
                .catch(() => h.response(getBadge(badgeConfig)));
        },
        validate: {
            params: joi.object({
                id: idSchema
            })
        }
    }
});
