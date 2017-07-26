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
            strategies: ['token', 'session'],
            scope: ['user']
        },
        plugins: {
            'hapi-swagger': {
                security: [{ token: [] }]
            }
        },
        handler: (request, reply) => {
            const { id } = request.params;
            const { collectionFactory, userFactory } = request.server.app;
            const { username } = request.auth.credentials;

            // get the collection and user
            return Promise.all([
                collectionFactory.get({ id }),
                userFactory.get({ username })
            ])
            .then(([oldCollection, user]) => {
                if (!oldCollection) {
                    throw boom.notFound(`Collection ${id} does not exist`);
                }

                // Check if user owns collection
                if (oldCollection.userId !== user.id) {
                    throw boom.unauthorized(`User ${username} does not own this collection`);
                }

                Object.assign(oldCollection, request.payload);

                return oldCollection.update()
                .then(updatedCollection => reply(updatedCollection.toJson()).code(200));
            })
            .catch(err => reply(boom.wrap(err)));
        },
        validate: {
            params: {
                id: idSchema
            },
            payload: schema.models.collection.update
        }
    }
});
