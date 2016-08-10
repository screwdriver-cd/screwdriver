'use strict';
const boom = require('boom');
const urlLib = require('url');
const validationSchema = require('screwdriver-data-schema');

module.exports = (server, options) => ({
    method: 'POST',
    path: '/builds',
    config: {
        description: 'Save a build',
        notes: 'Save a specific build',
        tags: ['api', 'builds'],
        auth: {
            strategies: ['token', 'session'],
            scope: ['user']
        },
        handler: (request, reply) => {
            const jobFactory = server.settings.app.jobFactory;
            const buildFactory = server.settings.app.buildFactory;
            const userFactory = server.settings.app.userFactory;
            const username = request.auth.credentials.username;
            const payload = {
                jobId: request.payload.jobId,
                apiUri: request.server.info.uri,
                username,
                password: options.password,
                tokenGen: (buildId) =>
                    request.server.plugins.login.generateToken(buildId, ['build'])
            };

            // Fetch the job and user models
            return Promise.all([
                jobFactory.get(payload.jobId),
                userFactory.get({ username })
            ]).then(([job, user]) =>
                // scmUrl is buried in the pipeline, so we get that from the job
                job.pipeline
                    // ask the user for permissions on this repo
                    .then(pipeline => user.getPermissions(pipeline.scmUrl))
                    // check if user has push access
                    .then(permissions => {
                        if (!permissions.push) {
                            throw boom.unauthorized(`User ${username} `
                                + 'does not have push permission for this repo');
                        }
                    })
                    // user has good permissions, create a build
                    .then(() => buildFactory.create(payload))
            ).then(build => {
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
