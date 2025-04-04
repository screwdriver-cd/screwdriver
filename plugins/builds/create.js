'use strict';

const urlLib = require('url');
const boom = require('@hapi/boom');
const validationSchema = require('screwdriver-data-schema');

module.exports = () => ({
    method: 'POST',
    path: '/builds',
    options: {
        description: 'Create and start a build',
        notes: 'This api is deprecated, use POST /events instead',
        tags: ['api', 'builds'],
        auth: {
            strategies: ['token'],
            scope: ['user', '!guest', 'pipeline']
        },
        plugins: {
            'hapi-swagger': {
                security: [{ token: [] }],
                deprecated: true
            }
        },
        handler: async (request, h) => {
            const { jobFactory } = request.server.app;
            const { buildFactory } = request.server.app;
            const { userFactory } = request.server.app;
            const { eventFactory } = request.server.app;
            const { scm } = buildFactory;
            const { username } = request.auth.credentials;
            const { scmContext } = request.auth.credentials;
            const { meta, jobId } = request.payload;
            const payload = {
                jobId,
                apiUri: request.server.info.uri,
                username,
                scmContext
            };
            const { isValidToken } = request.server.plugins.pipelines;

            if (meta) {
                payload.meta = meta;
            }

            // Fetch the job and user models
            return (
                Promise.all([jobFactory.get(payload.jobId), userFactory.get({ username, scmContext })])
                    // scmUri is buried in the pipeline, so we get that from the job
                    .then(([job, user]) =>
                        job.pipeline.then(pipeline => {
                            // In pipeline scope, check if the token is allowed to the pipeline
                            if (!isValidToken(pipeline.id, request.auth.credentials)) {
                                throw boom.unauthorized('Token does not have permission to this pipeline');
                            }

                            return (
                                user
                                    .getPermissions(pipeline.scmUri)
                                    // check if user has push access
                                    // eslint-disable-next-line consistent-return
                                    .then(permissions => {
                                        if (!permissions.push) {
                                            // the user who are not permitted is deleted from admins table
                                            const newAdmins = pipeline.admins;

                                            delete newAdmins[username];
                                            const newAdminUserIds = pipeline.adminUserIds.filter(
                                                adminUserId => adminUserId !== user.id
                                            );

                                            // This is needed to make admins dirty and update db
                                            pipeline.admins = newAdmins;
                                            pipeline.adminUserIds = newAdminUserIds;

                                            return pipeline.update().then(() => {
                                                throw boom.forbidden(
                                                    `User ${username} does not have push permission for this repo`
                                                );
                                            });
                                        }
                                    })
                                    // user has good permissions, add the user as an admin
                                    // eslint-disable-next-line consistent-return
                                    .then(() => {
                                        if (!pipeline.admins[username]) {
                                            const newAdmins = pipeline.admins;

                                            newAdmins[username] = true;
                                            // This is needed to make admins dirty and update db
                                            pipeline.admins = newAdmins;
                                        }

                                        const newAdminUserIds = pipeline.adminUserIds;

                                        if (!newAdminUserIds.includes(user.id)) {
                                            newAdminUserIds.push(user.id);

                                            // This is needed to make admins dirty and update db
                                            pipeline.adminUserIds = newAdminUserIds;
                                        }

                                        return pipeline.update();
                                    })
                                    // user has good permissions, sync and create a build
                                    .then(() => (job.isPR() ? pipeline.syncPR(job.prNum) : pipeline.sync()))
                                    .then(() => user.unsealToken())
                                    .then(token => {
                                        const scmConfig = {
                                            token,
                                            scmContext,
                                            scmUri: pipeline.scmUri,
                                            prNum: job.prNum
                                        };

                                        return scm
                                            .getCommitSha(scmConfig)
                                            .then(sha => {
                                                let type = 'pipeline';

                                                if (job.isPR()) {
                                                    type = 'pr';
                                                    payload.sha = sha; // pass sha to payload if it's a PR
                                                }

                                                return eventFactory.create({
                                                    pipelineId: pipeline.id,
                                                    meta,
                                                    startFrom: job.name,
                                                    type,
                                                    username,
                                                    scmContext,
                                                    sha,
                                                    skipMessage: 'skip build creation'
                                                });
                                            })
                                            .then(event => {
                                                payload.eventId = event.id;

                                                return job.isPR() ? scm.getPrInfo(scmConfig) : null;
                                            })
                                            .then(prInfo => {
                                                if (prInfo) {
                                                    payload.prRef = prInfo.ref;
                                                }

                                                const displayLabel = scmContext.split(':')[0];
                                                const displayName = displayLabel
                                                    ? `${displayLabel}:${user.username}`
                                                    : user.username;

                                                payload.causeMessage = `Started by ${displayName}`;

                                                return buildFactory.create(payload);
                                            });
                                    })
                            );
                        })
                    )
                    .then(async build => {
                        // everything succeeded, inform the user
                        const location = urlLib.format({
                            host: request.headers.host,
                            port: request.headers.port,
                            protocol: request.server.info.protocol,
                            pathname: `${request.path}/${build.id}`
                        });

                        return h
                            .response(await build.toJsonWithSteps())
                            .header('Location', location)
                            .code(201);
                    })
                    // something was botched
                    .catch(err => {
                        throw err;
                    })
            );
        },
        validate: {
            payload: validationSchema.models.build.create
        }
    }
});
