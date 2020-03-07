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
            strategies: ['token'],
            scope: ['user', '!guest']
        },
        plugins: {
            'hapi-swagger': {
                security: [{ token: [] }]
            }
        },
        handler: (request, reply) => {
            // Check if the collection to be created has a type 'default'
            if (request.payload.type === 'default') {
                return reply(
                    boom.forbidden(
                        'Collection with type "default" cannot be created by user'
                    )
                );
            }

            // if request.payload.type is either undefined or not part of allowed types,
            // then default it to normal
            if (!request.payload.type) {
                request.payload.type = 'normal';
            }

            const { collectionFactory, userFactory } = request.server.app;
            const { username, scmContext } = request.auth.credentials;

            return (
                userFactory
                    .get({ username, scmContext })
                    .then(user => {
                        if (!user) {
                            throw boom.notFound(
                                `User ${username} does not exist`
                            );
                        }

                        // Check if user already owns a collection with that name
                        return collectionFactory
                            .get({
                                name: request.payload.name,
                                userId: user.id
                            })
                            .then(collection => {
                                if (collection) {
                                    throw boom.conflict(
                                        `Collection already exists with the ID: ${collection.id}`,
                                        { existingId: collection.id }
                                    );
                                }

                                const config = {
                                    ...request.payload,
                                    userId: user.id
                                };

                                // Check that the pipelines exist for the pipelineIds specified.
                                if (request.payload.pipelineIds) {
                                    const {
                                        pipelineFactory
                                    } = request.server.app;

                                    return Promise.all(
                                        request.payload.pipelineIds.map(
                                            pipelineId =>
                                                pipelineFactory.get(pipelineId)
                                        )
                                    ).then(pipelines => {
                                        // If the pipeline exists, then add it to pipelineIds
                                        config.pipelineIds = pipelines
                                            .filter(pipeline => pipeline)
                                            .map(pipeline => pipeline.id);

                                        return collectionFactory.create(config);
                                    });
                                }

                                return collectionFactory.create(config);
                            });
                    })
                    .then(collection => {
                        const location = urlLib.format({
                            host: request.headers.host,
                            port: request.headers.port,
                            protocol: request.server.info.protocol,
                            pathname: `${request.path}/${collection.id}`
                        });

                        return reply(collection.toJson())
                            .header('Location', location)
                            .code(201);
                    })
                    // something broke, respond with error
                    .catch(err => reply(boom.boomify(err)))
            );
        },
        validate: {
            payload: schema.models.collection.create
        }
    }
});
