'use strict';

const boom = require('boom');
const urlLib = require('url');
const validationSchema = require('screwdriver-data-schema');

module.exports = () => ({
    method: 'POST',
    path: '/builds',
    config: {
        description: 'Create and start a build',
        notes: 'Create and start a specific build',
        tags: ['api', 'builds'],
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
            const jobFactory = request.server.app.jobFactory;
            const buildFactory = request.server.app.buildFactory;
            const userFactory = request.server.app.userFactory;
            const eventFactory = request.server.app.eventFactory;
            const scm = buildFactory.scm;
            const username = request.auth.credentials.username;
            const scmContext = request.auth.credentials.scmContext;
            const payload = {
                jobId: request.payload.jobId,
                apiUri: request.server.info.uri,
                username,
                scmContext
            };

            // Fetch the job and user models
            return Promise.all([
                jobFactory.get(payload.jobId),
                userFactory.get({ username, scmContext })
            ])
                // scmUri is buried in the pipeline, so we get that from the job
                .then(([job, user]) => job.pipeline.then(pipeline =>
                    user.getPermissions(pipeline.scmUri)
                        // check if user has push access
                        // eslint-disable-next-line consistent-return
                        .then((permissions) => {
                            if (!permissions.push) {
                                // the user who are not permitted is deleted from admins table
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
                            pipeline.update();
                        })
                        // user has good permissions, sync and create a build
                        .then(() => (job.isPR() ? pipeline.syncPR(job.prNum) : pipeline.sync()))
                        .then(() => user.unsealToken())
                        .then((token) => {
                            const scmConfig = {
                                token,
                                scmContext,
                                scmUri: pipeline.scmUri,
                                prNum: job.prNum
                            };

                            return scm.getCommitSha(scmConfig)
                                .then((sha) => {
                                    let type = 'pipeline';

                                    if (job.isPR()) {
                                        type = 'pr';
                                        payload.sha = sha; // pass sha to payload if it's a PR
                                    }

                                    return eventFactory.create({
                                        pipelineId: pipeline.id,
                                        type,
                                        username,
                                        scmContext,
                                        sha
                                    });
                                })
                                .then((event) => {
                                    payload.eventId = event.id;

                                    return job.isPR() ? scm.getPrInfo(scmConfig) : null;
                                })
                                .then((prInfo) => {
                                    if (prInfo) {
                                        payload.prRef = prInfo.ref;
                                    }

                                    return buildFactory.create(payload);
                                });
                        })))
                .then((build) => {
                    // everything succeeded, inform the user
                    const location = urlLib.format({
                        host: request.headers.host,
                        port: request.headers.port,
                        protocol: request.server.info.protocol,
                        pathname: `${request.path}/${build.id}`
                    });

                    return reply(build.toJson()).header('Location', location).code(201);
                })
                // something was botched
                .catch(err => reply(boom.wrap(err)));
        },
        validate: {
            payload: validationSchema.models.build.create
        }
    }
});
