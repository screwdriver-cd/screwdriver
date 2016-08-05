'use strict';
const async = require('async');
const boom = require('boom');
const hoek = require('hoek');
const schema = require('screwdriver-data-schema');
const urlLib = require('url');
const Model = require('screwdriver-models');

module.exports = (server, options) => ({
    method: 'POST',
    path: '/pipelines',
    config: {
        description: 'Create a new pipeline',
        notes: 'Create a specific pipeline',
        tags: ['api', 'pipelines'],
        auth: {
            strategies: ['token', 'session'],
            scope: ['user']
        },
        handler: (request, reply) => {
            const Pipeline = new Model.Pipeline(server.settings.app.datastore);
            const scmUrl = Pipeline.formatScmUrl(request.payload.scmUrl);
            const pipelineId = Pipeline.generateId({ scmUrl });
            const username = request.auth.credentials.username;
            const User = new Model.User(server.settings.app.datastore, options.password);

            async.waterfall([
                (next) => User.getPermissions({
                    username,
                    scmUrl
                }, next),
                (permissions, next) => {
                    if (!permissions.admin) {
                        return next(boom.unauthorized(`User ${username} `
                            + 'is not an admin of this repo'));
                    }

                    return Pipeline.get(pipelineId, next);
                },
                (pipelineExists, next) => {
                    if (pipelineExists) {
                        return next(boom.conflict('scmUrl needs to be unique'));
                    }
                    const admins = {};

                    admins[username] = true;
                    const pipelineConfig = hoek.applyToDefaults(request.payload,
                        {
                            admins,
                            scmUrl
                        });

                    return Pipeline.create(pipelineConfig, next);
                },
                (pipeline, next) => Pipeline.sync({ scmUrl }, (err) => {
                    if (err) {
                        return next(err);
                    }

                    return next(null, pipeline);
                })
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
            payload: schema.models.pipeline.create
        }
    }
});
