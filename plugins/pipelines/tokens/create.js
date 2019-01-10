'use strict';

const boom = require('boom');
const schema = require('screwdriver-data-schema');
const urlLib = require('url');

module.exports = () => ({
    method: 'POST',
    path: '/pipelines/{id}/tokens',
    config: {
        description: 'Create a new token for pipeline',
        notes: 'Create a specific token for pipeline',
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
            const tokenFactory = request.server.app.tokenFactory;
            const userFactory = request.server.app.userFactory;
            const pipelineFactory = request.server.app.pipelineFactory;
            const username = request.auth.credentials.username;
            const scmContext = request.auth.credentials.scmContext;
            const pipelineId = request.params.id;

            return Promise.all([
                pipelineFactory.get(pipelineId),
                userFactory.get({ username, scmContext })
            ]).then(([pipeline, user]) => {
                if (!pipeline) {
                    throw boom.notFound('Pipeline does not exist');
                }

                if (!user) {
                    throw boom.notFound(`User ${username} does not exist`);
                }

                // Check the user's permission and make sure the name is unique
                return Promise.all([
                    user.getPermissions(pipeline.scmUri).then((permissions) => {
                        if (!permissions.admin) {
                            throw boom.forbidden(`User ${username} `
                                + 'is not an admin of this repo');
                        }

                        return Promise.resolve();
                    }),
                    pipeline.tokens.then((tokens) => {
                        const match = tokens &&
                            tokens.find(t => t.name === request.payload.name);

                        if (match) {
                            throw boom.conflict(`Token ${match.name} already exists`);
                        }

                        return Promise.resolve();
                    })
                ])
                    .then(() => tokenFactory.create({
                        name: request.payload.name,
                        description: request.payload.description,
                        pipelineId
                    }))
                    .then((token) => {
                        const location = urlLib.format({
                            host: request.headers.host,
                            port: request.headers.port,
                            protocol: request.server.info.protocol,
                            pathname: `${request.path}/${token.id}`
                        });

                        return reply(token.toJson()).header('Location', location).code(201);
                    })
                    .catch(err => reply(boom.boomify(err)));
            });
        },
        validate: {
            payload: schema.models.token.create
        }
    }
});
