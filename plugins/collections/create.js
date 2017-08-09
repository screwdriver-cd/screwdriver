'use strict';

const boom = require('boom');
const schema = require('screwdriver-data-schema');
const urlLib = require('url');

module.exports = () => ({
    method: 'POST',
    path: '/collections',
    config: {
        description: 'Create a new collection',
        notes: 'Creates a collection',
        tags: ['api', 'collections'],
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
            const { collectionFactory, userFactory } = request.server.app;
            const { username } = request.auth.credentials;

            return userFactory.get({ username })
                .then((user) => {
                    if (!user) {
                        throw boom.notFound(`User ${username} does not exist`);
                    }

                    const config = Object.assign({}, request.payload, { userId: user.id });

                    // Check that the pipelines exist for the pipelineIds specified.
                    if (request.payload.pipelineIds) {
                        const { pipelineFactory } = request.server.app;

                        return Promise.all(request.payload.pipelineIds.map(pipelineId =>
                            pipelineFactory.get(pipelineId)))
                            .then((pipelines) => {
                            // If the pipeline exists, then add it to pipelineIds
                                config.pipelineIds = pipelines.filter(pipeline =>
                                    pipeline).map(pipeline => pipeline.id);

                                return collectionFactory.create(config);
                            });
                    }

                    return collectionFactory.create(config);
                })
                .then((collection) => {
                    const location = urlLib.format({
                        host: request.headers.host,
                        port: request.headers.port,
                        protocol: request.server.info.protocol,
                        pathname: `${request.path}/${collection.id}`
                    });

                    return reply(collection.toJson()).header('Location', location).code(201);
                })
                // something broke, respond with error
                .catch(err => reply(boom.wrap(err)));
        },
        validate: {
            payload: schema.models.collection.create
        }
    }
});
