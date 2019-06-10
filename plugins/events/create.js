'use strict';

const boom = require('boom');
const urlLib = require('url');
const validationSchema = require('screwdriver-data-schema');

module.exports = () => ({
    method: 'POST',
    path: '/events',
    config: {
        description: 'Create and start a event',
        notes: 'Create and start a specific event',
        tags: ['api', 'events'],
        auth: {
            strategies: ['token'],
            scope: ['user', '!guest', 'pipeline']
        },
        plugins: {
            'hapi-swagger': {
                security: [{ token: [] }]
            }
        },
        handler: (request, reply) => {
            const eventFactory = request.server.app.eventFactory;
            const pipelineFactory = request.server.app.pipelineFactory;
            const userFactory = request.server.app.userFactory;
            const buildFactory = request.server.app.buildFactory;
            const jobFactory = request.server.app.jobFactory;
            const scm = eventFactory.scm;
            const scmContext = request.auth.credentials.scmContext;
            const username = request.auth.credentials.username;
            const isValidToken = request.server.plugins.pipelines.isValidToken;
            const meta = request.payload.meta;
            const causeMessage = request.payload.causeMessage;
            const creator = request.payload.creator;
            const updateAdmins = request.server.plugins.events.updateAdmins;

            return Promise.resolve().then(() => {
                const buildId = request.payload.buildId;

                if (buildId) { // restart case
                    return buildFactory.get(buildId)
                        .then(b => jobFactory.get(b.jobId)
                            .then(j => ({
                                pipelineId: j.pipelineId,
                                startFrom: j.name,
                                parentBuildId: b.parentBuildId,
                                parentEventId: b.eventId
                            })));
                }

                return {
                    pipelineId: request.payload.pipelineId,
                    startFrom: request.payload.startFrom,
                    parentBuildId: request.payload.parentBuildId,
                    parentEventId: request.payload.parentEventId,
                    prNumber: request.payload.prNum
                };
            }).then(({ pipelineId, startFrom, parentBuildId, parentEventId, prNumber }) => {
                const payload = {
                    pipelineId,
                    scmContext,
                    startFrom,
                    type: 'pipeline',
                    username
                };

                let prNum = prNumber;

                if (parentEventId) {
                    payload.parentEventId = parentEventId;
                }

                if (parentBuildId) {
                    payload.parentBuildId = parentBuildId;
                }

                if (meta) {
                    payload.meta = meta;
                }

                if (causeMessage) {
                    payload.causeMessage = causeMessage;
                }

                if (creator) {
                    payload.creator = creator;
                }

                // Trigger "~pr" needs to have PR number given
                // Note: To kick start builds for all jobs under a PR,
                // you need both the prNum and the trigger "~pr" as startFrom
                if (startFrom.match(validationSchema.config.regex.PR_TRIGGER) && !prNum) {
                    throw boom.badRequest('Trigger "~pr" must be accompanied by a PR number');
                }

                if (!prNum) {
                    // If PR number isn't given, induce it from "startFrom"
                    // Match PR-prNum, then extract prNum
                    // e.g. if startFrom is "PR-1:main", prNumFullName will be "PR-1"; prNum will be "1"
                    const prNumFullName = startFrom.match(
                        validationSchema.config.regex.PR_JOB_NAME
                    );

                    prNum = prNumFullName ? prNumFullName[1].split('-')[1] : null;
                }

                // Fetch the job and user models
                return Promise.all([
                    pipelineFactory.get(pipelineId),
                    userFactory.get({ username, scmContext })
                ]).then(([pipeline, user]) => {
                    // In pipeline scope, check if the token is allowed to the pipeline
                    if (!isValidToken(pipeline.id, request.auth.credentials)) {
                        throw boom.unauthorized('Token does not have permission to this pipeline');
                    }

                    let scmConfig;
                    let permissions;

                    // Check if user has push access
                    return user.getPermissions(pipeline.scmUri)
                        .then((userPermissions) => {
                            permissions = userPermissions;

                            // Update admins
                            if (!prNum) {
                                return updateAdmins({ permissions, pipeline, username });
                            }

                            return Promise.resolve();
                        // Get scmConfig
                        }).then(() => user.unsealToken()
                            .then((token) => {
                                scmConfig = {
                                    prNum,
                                    scmContext,
                                    scmUri: pipeline.scmUri,
                                    token
                                };

                                // Get and set PR data; update admins
                                if (prNum) {
                                    payload.prNum = String(prNum);
                                    payload.type = 'pr';

                                    return Promise.all([
                                        scm.getChangedFiles({
                                            payload: null,
                                            type: 'pr',
                                            ...scmConfig
                                        }),
                                        scm.getPrInfo(scmConfig)
                                    ]).then(([files, prInfo]) => {
                                        if (files && files.length) {
                                            payload.changedFiles = files;
                                        }

                                        payload.prInfo = prInfo;
                                        payload.prRef = prInfo.ref;
                                        payload.chainPR = pipeline.chainPR;

                                        // PR author should be able to rerun their own PR build
                                        if (prInfo.username === username) {
                                            return Promise.resolve();
                                        }

                                        // Remove user from admins
                                        return updateAdmins({
                                            permissions,
                                            pipeline,
                                            username
                                        });
                                    });
                                }

                                return Promise.resolve();
                            })
                        )
                        // User has good permissions, create an event
                        .then(() => {
                            // If there is parentEvent, pass workflowGraph and sha to payload
                            // Skip PR, for PR builds, we should always start from latest commit
                            if (payload.parentEventId && !prNum) {
                                return eventFactory.get(parentEventId)
                                    .then((parentEvent) => {
                                        payload.workflowGraph = parentEvent.workflowGraph;
                                        payload.sha = parentEvent.sha;

                                        if (parentEvent.configPipelineSha) {
                                            payload.configPipelineSha =
                                                parentEvent.configPipelineSha;
                                        }
                                    });
                            }

                            return scm.getCommitSha(scmConfig).then((sha) => {
                                payload.sha = sha;
                            });
                        })
                        .then(() => eventFactory.create(payload));
                }).then((event) => {
                    if (event.builds === null) {
                        return reply(boom.notFound('No jobs to start.'));
                    }
                    // everything succeeded, inform the user
                    const location = urlLib.format({
                        host: request.headers.host,
                        port: request.headers.port,
                        protocol: request.server.info.protocol,
                        pathname: `${request.path}/${event.id}`
                    });

                    return reply(event.toJson()).header('Location', location).code(201);
                });
            }).catch(err => reply(boom.boomify(err)));
        },
        validate: {
            payload: validationSchema.models.event.create
        }
    }
});
