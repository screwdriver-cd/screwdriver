'use strict';

const joi = require('joi');
const schema = require('screwdriver-data-schema');
const workflowParser = require('screwdriver-workflow-parser');
const tinytim = require('tinytim');
const idSchema = joi.reach(schema.models.pipeline.base, 'id');

/**
 * Generate Badge URL
 * @method getUrl
 * @param  {String} badgeService            Badge service url
 * @param  {Object} statusColor             Mapping for status and color
 * @param  {Function} encodeBadgeSubject    Function to encode subject
 * @param  {Array}  [buildsStatus=[]]       An array of builds
 * @param  {String} [subject='job']         Subject of the badge
 * @return {String}
 */
function getUrl({
    badgeService,
    statusColor,
    encodeBadgeSubject,
    buildsStatus = [],
    subject = 'pipeline' }) {
    const counts = {};
    const parts = [];
    let worst = 'lightgrey';

    const levels = Object.keys(statusColor);

    buildsStatus.forEach((status) => {
        counts[status] = (counts[status] || 0) + 1;
    });

    levels.forEach((status) => {
        if (counts[status]) {
            parts.push(`${counts[status]} ${status}`);
            worst = statusColor[status];
        }
    });

    return tinytim.tim(badgeService, {
        subject: encodeBadgeSubject({ badgeService, subject }),
        status: parts.length > 0 ? parts.join(', ') : 'unknown',
        color: worst
    });
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

    nextJobs.forEach((job) => {
        const subJobs = dfs(workflowGraph, job);

        visited = new Set([...visited, ...subJobs]);
    });

    return visited;
}

module.exports = config => ({
    method: 'GET',
    path: '/pipelines/{id}/badge',
    config: {
        description: 'Get a badge for the pipeline',
        notes: 'Redirects to the badge service',
        tags: ['api', 'pipelines', 'badge'],
        handler: (request, reply) => {
            const factory = request.server.app.pipelineFactory;
            const badgeService = request.server.app.ecosystem.badges;
            const encodeBadgeSubject = request.server.plugins.pipelines.encodeBadgeSubject;
            const { statusColor } = config;
            const badgeConfig = {
                badgeService,
                statusColor,
                encodeBadgeSubject
            };

            return factory.get(request.params.id)
                .then((pipeline) => {
                    if (!pipeline) {
                        return reply.redirect(getUrl(badgeConfig));
                    }

                    return pipeline.getEvents({ sort: 'ascending' }).then((allEvents) => {
                        const getLastEffectiveEvent = (events) => {
                            const lastEvent = events.pop();

                            if (!lastEvent) {
                                return reply.redirect(getUrl(badgeConfig));
                            }

                            return lastEvent.getBuilds().then((builds) => {
                                if (!builds || builds.length < 1) {
                                    return getLastEffectiveEvent(events);
                                }

                                const buildsStatus = builds.reverse()
                                    .map(build => build.status.toLowerCase());

                                let workflowLength = 0;

                                if (lastEvent.workflowGraph) {
                                    const nextJobs = dfs(lastEvent.workflowGraph,
                                        lastEvent.startFrom,
                                        lastEvent.prNum);

                                    workflowLength = nextJobs.size;
                                }

                                for (let i = builds.length; i < workflowLength; i += 1) {
                                    buildsStatus[i] = 'unknown';
                                }

                                return reply.redirect(getUrl(Object.assign(
                                    badgeConfig, { buildsStatus, subject: pipeline.name })));
                            });
                        };

                        return getLastEffectiveEvent(allEvents);
                    });
                })
                .catch(() => reply.redirect(getUrl(badgeConfig)));
        },
        validate: {
            params: {
                id: idSchema
            }
        }
    }
});
