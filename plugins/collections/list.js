'use strict';

const boom = require('boom');
const schema = require('screwdriver-data-schema');
const listSchema = schema.models.collection.list;

module.exports = () => ({
    method: 'GET',
    path: '/collections',
    config: {
        description: 'Get collections for requesting user',
        notes: 'Returns all collection records belonging to the requesting user',
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
            const { userFactory, collectionFactory } = request.server.app;
            const { username } = request.auth.credentials;

            return userFactory.get({ username })
                .then((user) => {
                    if (!user) {
                        throw boom.notFound(`User ${username} does not exist`);
                    }

                    const config = {
                        params: {
                            userId: user.id
                        }
                    };

                    return collectionFactory.list(config)
                        .then(collections => reply(collections.map(c => c.toJson())));
                })
                .catch(err => reply(boom.wrap(err)));
        },
        response: {
            schema: listSchema
        }
    }
});
