'use strict';

const boom = require('@hapi/boom');
const schema = require('screwdriver-data-schema');
const joi = require('joi');
const idSchema = schema.models.collection.base.extract('id');

module.exports = () => ({
    method: 'DELETE',
    path: '/collections/{id}',
    options: {
        description: 'Delete a single collection',
        notes: 'Returns null if successful',
        tags: ['api', 'collections'],
        auth: {
            strategies: ['token'],
            scope: ['user', '!guest']
        },

        handler: async (request, h) => {
            const { collectionFactory, userFactory } = request.server.app;
            const { username, scmContext } = request.auth.credentials;

            // Fetch the collection and user models
            return Promise.all([collectionFactory.get(request.params.id), userFactory.get({ username, scmContext })])
                .then(([collection, user]) => {
                    if (!collection) {
                        throw boom.notFound('Collection does not exist');
                    }
                    if (!user) {
                        throw boom.notFound(`User ${username} does not exist`);
                    }
                    if (collection.userId !== user.id) {
                        throw boom.forbidden(`User ${username} does not own collection`);
                    }
                    if (collection.type === 'default') {
                        throw boom.forbidden(`
                        Collection with type "default" cannot be deleted by user
                    `);
                    }

                    return collection.remove().then(() => h.response().code(204));
                })
                .catch(err => {
                    throw err;
                });
        },
        validate: {
            params: joi.object({
                id: idSchema
            })
        }
    }
});
