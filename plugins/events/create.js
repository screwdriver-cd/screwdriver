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
            scope: ['user', '!guest']
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
                    parentEventId: request.payload.parentEventId
                };
            }).then(({ pipelineId, startFrom, parentBuildId, parentEventId }) => {
                const payload = {
                    pipelineId,
                    scmContext,
                    startFrom,
                    type: 'pipeline',
                    username
                };

                if (parentEventId) {
                    payload.parentEventId = parentEventId;
                }

                if (parentBuildId) {
                    payload.parentBuildId = parentBuildId;
                }

                // Match PR-prNum, then extract prNum
                // e.g. if startFrom is "PR-1:main", prNumFullName will be "PR-1"; prNum will be "1"
                const prNumFullName = startFrom.match(validationSchema.config.regex.PR_JOB_NAME);
                const prNum = prNumFullName ? prNumFullName[1].split('-')[1] : null;

                // Fetch the job and user models
                return Promise.all([
                    pipelineFactory.get(pipelineId),
                    userFactory.get({ username, scmContext })
                ]).then(([pipeline, user]) => user.getPermissions(pipeline.scmUri)
                    // Check if user has push access
                    // eslint-disable-next-line consistent-return
                    .then((permissions) => {
                        if (!permissions.push) {
                            const newAdmins = pipeline.admins;

                            delete newAdmins[username];
                            // This is needed to make admins dirty and update db
                            pipeline.admins = newAdmins;

                            return pipeline.update()
                                .then(() => {
                                    throw boom.unauthorized(`User ${username} `
                                    + 'does not have push permission for this repo');
                                });
                        }
                    })
                    // user has good permissions, add the user as an admin
                    .then(() => {
                        const newAdmins = pipeline.admins;

                        newAdmins[username] = true;
                        // This is needed to make admins dirty and update db
                        pipeline.admins = newAdmins;

                        return pipeline.update();
                    })
                    // User has good permissions, create an event
                    .then(() => user.unsealToken())
                    .then((token) => {
                        const scmConfig = {
                            prNum,
                            scmContext,
                            scmUri: pipeline.scmUri,
                            token
                        };

                        if (prNum) {
                            payload.prNum = prNum;
                            payload.type = 'pr';
                        }

                        // If there is parentEvent, pass workflowGraph and sha to payload
                        if (payload.parentEventId) {
                            return eventFactory.get(parentEventId)
                                .then((parentEvent) => {
                                    payload.workflowGraph = parentEvent.workflowGraph;
                                    payload.sha = parentEvent.sha;

                                    if (prNum) {
                                        return scm.getPrInfo(scmConfig);
                                    }

                                    return null;
                                });
                        }

                        return scm.getCommitSha(scmConfig).then((sha) => {
                            payload.sha = sha;

                            // For PRs
                            if (prNum) {
                                return scm.getPrInfo(scmConfig);
                            }

                            return null;
                        });
                    })
                    .then((prInfo) => {
                        if (prInfo) {
                            payload.prInfo = prInfo;
                            payload.prRef = prInfo.ref;
                        }

                        return eventFactory.create(payload);
                    })
                ).then((event) => {
                    // everything succeeded, inform the user
                    const location = urlLib.format({
                        host: request.headers.host,
                        port: request.headers.port,
                        protocol: request.server.info.protocol,
                        pathname: `${request.path}/${event.id}`
                    });

                    return reply(event.toJson()).header('Location', location).code(201);
                });
            }).catch(err => reply(boom.wrap(err)));
        },
        validate: {
            payload: validationSchema.models.event.create
        }
    }
});
