'use strict';

const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const idSchema = joi.reach(schema.models.token.base, 'id');

module.exports = () => ({
    method: 'PUT',
    path: '/tokens/{id}',
    config: {
        description: 'Update a token',
        notes: 'Update a specific token',
        tags: ['api', 'tokens'],
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
            const { tokenFactory } = request.server.app;
            const { userFactory } = request.server.app;
            const { username } = request.auth.credentials;
            const { scmContext } = request.auth.credentials;

            return Promise.all([tokenFactory.get(request.params.id), userFactory.get({ username, scmContext })])
                .then(([token, user]) => {
                    if (!token) {
                        throw boom.notFound('Token does not exist');
                    }

                    if (!user) {
                        throw boom.notFound('User does not exist');
                    }

                    if (token.userId !== user.id) {
                        throw boom.forbidden('User does not own token');
                    }

                    return user.tokens.then(tokens => {
                        // Make sure it won't cause a name conflict
                        const match = tokens && tokens.find(t => t.name === request.payload.name);

                        if (match && request.params.id !== match.id) {
                            throw boom.conflict(`Token with name ${match.name} already exists`);
                        }

                        Object.keys(request.payload).forEach(key => {
                            token[key] = request.payload[key];
                        });

                        return token.update().then(() => reply(token.toJson()).code(200));
                    });
                })
                .catch(err => reply(boom.boomify(err)));
        },
        validate: {
            params: {
                id: idSchema
            },
            payload: schema.models.token.update
        }
    }
});
