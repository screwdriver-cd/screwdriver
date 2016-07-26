'use strict';
const boom = require('boom');
const schema = require('screwdriver-data-schema');
const urlLib = require('url');
const Model = require('screwdriver-models');

module.exports = (datastore) => ({
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
            const scmUrl = request.payload.scmUrl;
            const Pipeline = new Model.Pipeline(datastore);
            const pipelineId = Pipeline.generateId({ scmUrl });

            /* eslint-disable consistent-return */
            Pipeline.get(pipelineId, (error, data) => {
                if (error) {
                    return reply(boom.wrap(error));
                }
                if (data) {
                    return reply(boom.conflict('scmUrl needs to be unique'));
                }

                Pipeline.create(request.payload, (err, result) => {
                    if (err) {
                        return reply(boom.wrap(err));
                    }

                    const location = urlLib.format({
                        host: request.headers.host,
                        port: request.headers.port,
                        protocol: request.server.info.protocol,
                        pathname: `${request.path}/${result.id}`
                    });

                    Pipeline.sync({
                        scmUrl
                    }, (e) => {
                        if (e) {
                            return reply(boom.wrap(e));
                        }

                        return reply(result).header('Location', location).code(201);
                    });
                });
            });
        },
        validate: {
            payload: schema.models.pipeline.create
        }
    }
});
