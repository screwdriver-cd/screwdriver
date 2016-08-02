'use strict';
const boom = require('boom');
const urlLib = require('url');
const validationSchema = require('screwdriver-data-schema');
const Model = require('screwdriver-models');

module.exports = (datastore, executor) => ({
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
            const Build = new Model.Build(datastore, executor);

            Build.create(request.payload, (err, data) => {
                if (err) {
                    return reply(boom.wrap(err));
                }

                const location = urlLib.format({
                    host: request.headers.host,
                    port: request.headers.port,
                    protocol: request.server.info.protocol,
                    pathname: `${request.path}/${data.id}`
                });

                return reply(data).header('Location', location).code(201);
            });
        },
        validate: {
            payload: validationSchema.models.build.create
        }
    }
});
