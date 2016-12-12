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
            strategies: ['token', 'session'],
            scope: ['user']
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
            const payload = {
                jobId: request.payload.jobId,
                apiUri: request.server.info.uri,
                username
            };

            // Fetch the job and user models
            return Promise.all([
                jobFactory.get(payload.jobId),
                userFactory.get({ username })
            ]).then(([job, user]) =>
                // scmUri is buried in the pipeline, so we get that from the job
                job.pipeline.then(pipeline =>
                    // ask the user for permissions on this repo
                    user.getPermissions(pipeline.scmUri)
                    // check if user has push access
                    .then((permissions) => {
                        if (!permissions.push) {
                            throw boom.unauthorized(`User ${username} `
                                + 'does not have push permission for this repo');
                        }
                    })
                    // user has good permissions, sync and create a build
                    .then(() => pipeline.sync())
                    .then(() => user.unsealToken())
                    .then(token => scm.getCommitSha({ token, scmUri: pipeline.scmUri }))
                    .then(sha => eventFactory.create({
                        pipelineId: pipeline.id,
                        type: job.isPR() ? 'pr' : 'pipeline',
                        workflow: job.isPR() ? [job.name] : pipeline.workflow,
                        username,
                        sha
                    }))
                    .then((event) => {
                        payload.eventId = event.id;

                        return buildFactory.create(payload);
                    })
            )).then((build) => {
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
