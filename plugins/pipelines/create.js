'use strict';
const async = require('async');
const boom = require('boom');
const hoek = require('hoek');
const schema = require('screwdriver-data-schema');
const urlLib = require('url');
const Model = require('screwdriver-models');

module.exports = (datastore, password) => ({
    method: 'POST',
    path: '/pipelines',
    config: {
        description: 'Create a new pipeline',
        notes: 'Create a specific pipeline',
        tags: ['api', 'pipelines'],
        auth: {
            strategies: ['token', 'session']
        },
        handler: (request, reply) => {
            const Pipeline = new Model.Pipeline(datastore);
            const scmUrl = Pipeline.formatScmUrl(request.payload.scmUrl);
            const pipelineId = Pipeline.generateId({ scmUrl });
            const username = request.auth.credentials.username;
            const User = new Model.User(datastore, password);

            async.waterfall([
                (next) => User.getPermissions({
                    username,
                    scmUrl
                }, next),
                (permissions, next) => {
                    if (!permissions.admin) {
                        return reply(boom.unauthorized(`User ${username} `
                            + 'is not an admin of this repo'));
                    }

                    return Pipeline.get(pipelineId, next);
                },
                (data, next) => {
                    if (data) {
                        return reply(boom.conflict('scmUrl needs to be unique'));
                    }
                    const admins = {};

                    admins[username] = true;
                    const pipelineConfig = hoek.applyToDefaults(request.payload, { admins });

                    return Pipeline.create(pipelineConfig, next);
                },
                (pipeline, next) => Pipeline.sync({ scmUrl }, (err) => {
                    if (err) {
                        next(err);
                    }
                    next(null, pipeline);
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
