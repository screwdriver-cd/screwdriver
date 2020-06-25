'use strict';

const boom = require('boom');
const schema = require('screwdriver-data-schema');
const urlLib = require('url');

module.exports = () => ({
    method: 'POST',
    path: '/tokens',
    config: {
        description: 'Create a new token',
        notes: 'Create a specific token',
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

            return (
                userFactory
                    .get({ username, scmContext })
                    .then(user => {
                        if (!user) {
                            throw boom.notFound(`User ${username} does not exist`);
                        }

                        return user.tokens.then(tokens => {
                            // Make sure the name is unique
                            const match = tokens && tokens.find(t => t.name === request.payload.name);

                            if (match) {
                                throw boom.conflict(`Token with name ${match.name} already exists`);
                            }

                            return tokenFactory.create({
                                name: request.payload.name,
                                description: request.payload.description,
                                userId: user.id
                            });
                        });
                    })
                    .then(token => {
                        const location = urlLib.format({
                            host: request.headers.host,
                            port: request.headers.port,
                            protocol: request.server.info.protocol,
                            pathname: `${request.path}/${token.id}`
                        });

                        return reply(token.toJson())
                            .header('Location', location)
                            .code(201);
                    })
                    // something broke, respond with error
                    .catch(err => reply(boom.boomify(err)))
            );
        },
        validate: {
            payload: schema.models.token.create
        }
    }
});
