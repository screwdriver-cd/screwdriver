'use strict';

const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const idSchema = joi.reach(schema.models.collection.base, 'id');

module.exports = () => ({
    method: 'PUT',
    path: '/collections/{id}',
    config: {
        description: 'Update a collection',
        notes: 'Update a specific collection',
        tags: ['api', 'collection'],
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
            // Check if the collection to be updated has a type 'default'
            if (request.payload.type === 'default') {
                throw boom.forbidden('Collection can not be updated to type "default"');
            }

            const { id } = request.params;
            const { collectionFactory, userFactory } = request.server.app;
            const { username, scmContext } = request.auth.credentials;

            // get the collection and user
            return Promise.all([
                collectionFactory.get({ id }),
                userFactory.get({ username, scmContext })
            ])
                .then(([oldCollection, user]) => {
                    if (!oldCollection) {
                        throw boom.notFound(`Collection ${id} does not exist`);
                    }

                    // Check if user owns collection
                    if (oldCollection.userId !== user.id) {
                        throw boom.forbidden(`User ${username} does not own this collection`);
                    }

                    Object.assign(oldCollection, request.payload);

                    // Check that all pipelines exist before updating the pipelineIds of
                    // the collection
                    if (request.payload.pipelineIds) {
                        const { pipelineFactory } = request.server.app;

                        return Promise.all(request.payload.pipelineIds.map(pipelineId =>
                            pipelineFactory.get(pipelineId)))
                            .then((pipelines) => {
                                // If the pipeline exists, then add its id to the array of pipelineIds
                                // in oldCollection
                                oldCollection.pipelineIds = pipelines.filter(pipeline =>
                                    pipeline).map(pipeline => pipeline.id);

                                return oldCollection.update()
                                    .then(updatedCollection =>
                                        reply(updatedCollection.toJson()).code(200)
                                    );
                            });
                    }

                    return oldCollection.update()
                        .then(updatedCollection => reply(updatedCollection.toJson()).code(200));
                })
                .catch(err => reply(boom.boomify(err)));
        },
        validate: {
            params: {
                id: idSchema
            },
            payload: schema.models.collection.update
        }
    }
});
