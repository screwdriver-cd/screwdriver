'use strict';

const boom = require('@hapi/boom');
const schema = require('screwdriver-data-schema');
const listSchema = schema.models.collection.list;

module.exports = () => ({
    method: 'GET',
    path: '/collections',
    options: {
        description: 'Get collections for requesting user',
        notes: 'Returns all collection records belonging to the requesting user',
        tags: ['api', 'collections'],
        auth: {
            strategies: ['token'],
            scope: ['user', '!guest']
        },

        handler: async (request, h) => {
            const { userFactory, collectionFactory } = request.server.app;
            const { username, scmContext } = request.auth.credentials;

            return userFactory
                .get({ username, scmContext })
                .then(user => {
                    if (!user) {
                        throw boom.notFound(`User ${username} does not exist`);
                    }

                    const config = {
                        params: {
                            userId: user.id
                        }
                    };

                    return collectionFactory
                        .list(config)
                        .then(collections => h.response(collections.map(c => c.toJson())));
                })
                .catch(err => {
                    throw err;
                });
        },
        response: {
            schema: listSchema
        }
    }
});
