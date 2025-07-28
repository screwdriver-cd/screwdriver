'use strict';

const joi = require('joi');
const schema = require('screwdriver-data-schema');
const idSchema = schema.models.pipeline.base.extract('id');
const activeStatuses = schema.models.event.activeStatuses;
const logger = require('screwdriver-logger');
const { getPipelineBadge } = require('./helper');

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
                        type: 'pipeline',
                        status: activeStatuses
                    },
                    // removing these fields trims most of the bytes
                    exclude: [
                        'workflowGraph',
                        'meta',
                        'commit',
                        'causeMessage',
                        'createTime',
                        'creator',
                        'startFrom',
                        'sha',
                        'pr',
                        'baseBranch'
                    ],
                    paginate: {
                        count: 100
                    },
                    sort: 'descending',
                    sortBy: 'createTime'
                });

                if (!latestEvents || Object.keys(latestEvents).length === 0) {
                    return h.response(getPipelineBadge(badgeConfig)).header('Content-Type', contentType);
                }

                // Only care about latest
                const lastEvent = latestEvents[0];
                const builds = await lastEvent.getBuilds({ readOnly: true, sortBy: 'id', sort: 'descending' });

                if (!builds || builds.length < 1) {
                    return h.response(getPipelineBadge(badgeConfig)).header('Content-Type', contentType);
                }

                // Convert build statuses
                const buildsStatus = builds.map(build => build.status.toLowerCase());

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
