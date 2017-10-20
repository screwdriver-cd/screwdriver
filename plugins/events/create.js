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
            strategies: ['token', 'session'],
            scope: ['user']
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
            const scm = eventFactory.scm;
            const pipelineId = request.payload.pipelineId;
            const scmContext = request.auth.credentials.scmContext;
            const startFrom = request.payload.startFrom;
            const username = request.auth.credentials.username;
            const payload = {
                pipelineId,
                scmContext,
                startFrom,
                type: 'pipeline',
                username
            };
            // Match PR-prNum, then extract prNum
            // e.g. if startFrom is "PR-1:main", prNumFullName will be "PR-1"; prNum will be "1"
            const prNumFullName = startFrom.match(validationSchema.config.regex.PR_JOB_NAME);
            const prNum = prNumFullName ? prNumFullName[1].split('-')[1] : null;

            // Fetch the job and user models
            return Promise.all([
                pipelineFactory.get(pipelineId),
                userFactory.get({ username, scmContext })
            ])
                // Get scmUri
                .then(([pipeline, user]) =>
                    user.getPermissions(pipeline.scmUri)
                        // Check if user has push access
                        .then((permissions) => {
                            if (!permissions.push) {
                                throw boom.unauthorized(`User ${username} `
                            + 'does not have push permission for this repo');
                            }
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

                            // Get commit sha
                            return scm.getCommitSha(scmConfig)
                                .then((sha) => {
                                    payload.sha = sha;

                                    // For PRs
                                    if (prNum) {
                                        payload.prNum = prNum;
                                        payload.type = 'pr';

                                        return scm.getPrInfo(scmConfig);
                                    }

                                    return null;
                                })
                                .then((prInfo) => {
                                    if (prInfo) {
                                        payload.prRef = prInfo.ref;
                                    }

                                    return eventFactory.create(payload);
                                });
                        }))
                .then((event) => {
                    // everything succeeded, inform the user
                    const location = urlLib.format({
                        host: request.headers.host,
                        port: request.headers.port,
                        protocol: request.server.info.protocol,
                        pathname: `${request.path}/${event.id}`
                    });

                    return reply(event.toJson()).header('Location', location).code(201);
                })
                // something was botched
                .catch(err => reply(boom.wrap(err)));
        },
        validate: {
            payload: validationSchema.models.event.create
        }
    }
});
