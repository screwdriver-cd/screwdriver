'use strict';

const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const getSchema = joi.array().items(schema.models.token.get);

module.exports = () => ({
    method: 'GET',
    path: '/tokens',
    config: {
        description: 'Get tokens with pagination',
        notes: 'Returns all token records belonging to the current user',
        tags: ['api', 'tokens'],
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
            const userFactory = request.server.app.userFactory;
            const username = request.auth.credentials.username;

            return userFactory.get({ username })
                .then((user) => {
                    if (!user) {
                        throw boom.notFound(`User ${username} does not exist`);
                    }

                    return user.tokens;
                })
                .then(tokens => reply(tokens.map((token) => {
                    const output = token.toJson();

                    delete output.userId;

                    return output;
                })))
                .catch(err => reply(boom.wrap(err)));
        },
        response: {
            schema: getSchema
        }
    }
});
