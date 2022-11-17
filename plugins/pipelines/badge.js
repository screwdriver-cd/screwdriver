'use strict';

const joi = require('joi');
const schema = require('screwdriver-data-schema');
const idSchema = schema.models.pipeline.base.extract('id');
const logger = require('screwdriver-logger');
const workflowParser = require('screwdriver-workflow-parser');
const { getPipelineBadge } = require('./helper');

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
            const { pipelineFactory, eventFactory } = request.server.app;
            const pipelineId = request.params.id;
            const { statusColor } = config;
            const badgeConfig = {
                statusColor
            };
            const contentType = 'image/svg+xml;charset=utf-8';

            try {
                // Get pipeline
                const pipeline = await pipelineFactory.get(pipelineId);

                if (!pipeline) {
                    return h.response(getPipelineBadge(badgeConfig)).header('Content-Type', contentType);
                }

                // Get latest pipeline events
                const latestEvents = await eventFactory.list({
                    params: {
                        pipelineId,
                        parentEventId: null,
                        type: 'pipeline'
                    },
                    paginate: {
                        count: 1
                    }
                });

                if (!latestEvents || Object.keys(latestEvents).length === 0) {
                    return h.response(getPipelineBadge(badgeConfig)).header('Content-Type', contentType);
                }

                // Only care about latest
                const lastEvent = latestEvents[0];
                const builds = await lastEvent.getBuilds({ readOnly: true });

                if (!builds || builds.length < 1) {
                    return h.response(getPipelineBadge(badgeConfig)).header('Content-Type', contentType);
                }

                const buildsStatus = builds.reverse().map(build => build.status.toLowerCase());
                // Get downstream jobs
                const nextJobs = dfs(lastEvent.workflowGraph, lastEvent.startFrom, lastEvent.prNum);
                const workflowLength = nextJobs.size;

                // Set empty build status to unknown
                for (let i = builds.length; i < workflowLength; i += 1) {
                    buildsStatus[i] = 'unknown';
                }

                return h
                    .response(
                        getPipelineBadge(
                            Object.assign(badgeConfig, {
                                buildsStatus,
                                label: pipeline.name
                            })
                        )
                    )
                    .header('Content-Type', contentType);
            } catch (err) {
                logger.error(`Failed to get badge for pipeline:${pipelineId}: ${err.message}`);

                return h.response(getPipelineBadge(badgeConfig));
            }
        },
        validate: {
            params: joi.object({
                id: idSchema
            })
        }
    }
});
