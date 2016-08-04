'use strict';
const async = require('async');
const boom = require('boom');
const hoek = require('hoek');
const urlLib = require('url');
const validationSchema = require('screwdriver-data-schema');
const Model = require('screwdriver-models');

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
            const build = new Model.Build(
                server.settings.app.datastore,
                server.settings.app.executor,
                options.password
            );
            const job = new Model.Job(
                server.settings.app.datastore
            );
            const pipeline = new Model.Pipeline(
                server.settings.app.datastore
            );
            const user = new Model.User(
                server.settings.app.datastore,
                options.password
            );
            const payload = {
                jobId: request.payload.jobId,
                apiUri: request.server.info.uri,
                tokenGen: (buildId) =>
                    request.server.plugins.login.generateToken(buildId, ['build'])
            };
            const username = request.auth.credentials.username;

            // Check if user can create a build
            async.waterfall([
                // Get job
                (next) => job.get(request.payload.jobId, next),

                // Get pipeline
                (jobObj, next) => pipeline.get(jobObj.pipelineId, next),

                // Get permissions
                (pipelineObj, next) => user.getPermissions({
                    username,
                    scmUrl: pipelineObj.scmUrl
                }, next),

                (permissions, next) => {
                    if (!permissions.push) {
                        return next(boom.unauthorized(`User ${username} `
                          + 'does not have push permission for this repo'));
                    }

                    return next();
                },
                (next) => {
                    const config = hoek.applyToDefaults(payload, {
                        username
                    });

                    build.create(config, next);
                }
            ], (err, result) => {
                if (err) {
                    return reply(boom.wrap(err));
                }

                const location = urlLib.format({
                    host: request.headers.host,
                    port: request.headers.port,
                    protocol: request.server.info.protocol,
                    pathname: `${request.path}/${result.id}`
                });

                return reply(result).header('Location', location).code(201);
            });
        },
        validate: {
            payload: validationSchema.models.build.create
        }
    }
});
