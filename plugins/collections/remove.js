'use strict';

const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const idSchema = joi.reach(schema.models.collection.base, 'id');

module.exports = () => ({
    method: 'DELETE',
    path: '/collections/{id}',
    config: {
        description: 'Delete a single collection',
        notes: 'Returns null if successful',
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

            // Fetch the collection and user models
            return Promise.all([
                collectionFactory.get(request.params.id),
                userFactory.get({ username })
            ]).then(([collection, user]) => {
                if (!collection) {
                    throw boom.notFound('Collection does not exist');
                }
                if (!user) {
                    throw boom.notFound(`User ${username} does not exist`);
                }
                if (collection.userId !== user.id) {
                    throw boom.unauthorized(`User ${username} does not own collection`);
                }

                return collection.remove()
                    .then(() => reply().code(204));
            })
                .catch(err => reply(boom.wrap(err)));
        },
        validate: {
            params: {
                id: idSchema
            }
        }
    }
});
