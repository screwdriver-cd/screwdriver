'use strict';

const boom = require('boom');
const schema = require('screwdriver-data-schema');
const urlLib = require('url');
const helper = require('./helper');

module.exports = () => ({
    method: 'POST',
    path: '/pipelines',
    config: {
        description: 'Create a new pipeline',
        notes: 'Create a specific pipeline',
        tags: ['api', 'pipelines'],
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
            const checkoutUrl = helper.formatCheckoutUrl(request.payload.checkoutUrl);
            const rootDir = helper.sanitizeRootDir(request.payload.rootDir);
            const { pipelineFactory, userFactory, collectionFactory } = request.server.app;
            const username = request.auth.credentials.username;
            const scmContext = request.auth.credentials.scmContext;

            // fetch the user
            return userFactory.get({ username, scmContext })
                .then(user => user.unsealToken()
                    .then(token => pipelineFactory.scm.parseUrl({
                        scmContext,
                        rootDir,
                        checkoutUrl,
                        token
                    }))
                    // get the user permissions for the repo
                    .then(scmUri => user.getPermissions(scmUri)
                        // if the user isn't an admin, reject
                        .then((permissions) => {
                            if (!permissions.admin) {
                                throw boom.forbidden(
                                    `User ${user.getFullDisplayName()} is not an admin of this repo`
                                );
                            }
                        })
                        // see if there is already a pipeline
                        .then(() => pipelineFactory.get({ scmUri }))
                        // if there is already a pipeline for the checkoutUrl, reject
                        .then((pipeline) => {
                            if (pipeline) {
                                throw boom.conflict(
                                    `Pipeline already exists with the ID: ${pipeline.id}`,
                                    { existingId: pipeline.id }
                                );
                            }
                        })
                        // set up pipeline admins, and create a new pipeline
                        .then(() => {
                            const pipelineConfig = {
                                admins: {
                                    [username]: true
                                },
                                scmContext,
                                scmUri
                            };

                            return pipelineFactory.create(pipelineConfig);
                        })
                        // get the default collection for current user
                        .then(pipeline =>
                            collectionFactory.list({
                                userId: user.id
                            })
                                .then((collections) => {
                                    const defaultCollection = collections.find(collection =>
                                        collection.type === 'default');

                                    if (!defaultCollection) {
                                        return collectionFactory.create({
                                            userId: user.id,
                                            name: 'My Pipelines',
                                            description:
                                                `The default collection for ${user.username}`,
                                            type: 'default'
                                        });
                                    }

                                    return defaultCollection;
                                })
                                .then((defaultCollection) => {
                                    // Check if the pipeline exists in the default collection
                                    // to prevent the situation where a pipeline is deleted and then created right away with the same id
                                    if (defaultCollection.pipelineIds.includes(pipeline.id)) {
                                        return defaultCollection;
                                    }

                                    Object.assign(defaultCollection, {
                                        pipelineIds: [
                                            ...defaultCollection.pipelineIds,
                                            pipeline.id
                                        ]
                                    });

                                    return defaultCollection.update();
                                })
                                .then(() => {
                                    // TODO: decide to put this outside or inside
                                    Promise.all([
                                        pipeline.sync(),
                                        pipeline.addWebhook(
                                            `${request.server.info.uri}/v4/webhooks`)
                                    ]).then((results) => {
                                        const location = urlLib.format({
                                            host: request.headers.host,
                                            port: request.headers.port,
                                            protocol: request.server.info.protocol,
                                            pathname: `${request.path}/${pipeline.id}`
                                        });

                                        return reply(results[0].toJson())
                                            .header('Location', location)
                                            .code(201);
                                    });
                                })
                        )
                    )
                )
                // something broke, respond with error
                .catch(err => reply(boom.boomify(err)));
        },
        validate: {
            payload: schema.models.pipeline.create
        }
    }
});
