'use strict';
const boom = require('boom');
const hashr = require('screwdriver-hashr');
const urlLib = require('url');
const schema = require('screwdriver-data-schema');
const createSchema = schema.models.platform.create;
const Model = require('screwdriver-models');

module.exports = (datastore) => ({
    method: 'POST',
    path: '/platforms',
    config: {
        description: 'Create a platform',
        notes: 'Create a specific platform',
        tags: ['api', 'platforms'],
        auth: {
            strategies: ['token', 'session']
        },
        handler: (request, reply) => {
            const Platform = new Model.Platform(datastore);
            const config = request.payload;
            const id = hashr.sha1({
                name: config.name,
                version: config.version
            });
            const location = urlLib.format({
                host: request.headers.host,
                port: request.headers.port,
                protocol: request.server.info.protocol,
                pathname: `${request.path}/${id}`
            });

            /* eslint-disable consistent-return */
            Platform.get(id, (error, data) => {
                if (error) {
                    return reply(boom.wrap(error));
                }
                if (data) {
                    return reply(boom.conflict('Platform name and version need to be unique'));
                }

                Platform.create(config, (err, result) => {
                    if (err) {
                        return reply(boom.wrap(err));
                    }

                    return reply(result).header('Location', location).code(201);
                });
            });
        },
        validate: {
            payload: createSchema
        }
    }
});
