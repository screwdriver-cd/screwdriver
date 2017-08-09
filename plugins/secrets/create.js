'use strict';

const boom = require('boom');
const schema = require('screwdriver-data-schema');
const urlLib = require('url');

module.exports = () => ({
    method: 'POST',
    path: '/secrets',
    config: {
        description: 'Create a new secret',
        notes: 'Create a specific secret',
        tags: ['api', 'secrets'],
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
            const pipelineFactory = request.server.app.pipelineFactory;
            const secretFactory = request.server.app.secretFactory;
            const username = request.auth.credentials.username;

            return Promise.all([
                pipelineFactory.get(request.payload.pipelineId),
                userFactory.get({ username })
            ]).then(([pipeline, user]) => {
                if (!pipeline) {
                    throw boom.notFound(`Pipeline ${request.payload.pipelineId} does not exist`);
                }

                if (!user) {
                    throw boom.notFound(`User ${username} does not exist`);
                }

                return user.getPermissions(pipeline.scmUri)
                    .then((permissions) => {
                        if (!permissions.admin) {
                            throw boom.unauthorized(
                                `User ${username} is not an admin of this repo`);
                        }
                    })
                    // check if secret already exists
                    .then(() => secretFactory.get({
                        pipelineId: request.payload.pipelineId,
                        name: request.payload.name
                    }))
                    // if secret already exists, reject
                    .then((secret) => {
                        if (secret) {
                            throw boom.conflict(`Secret already exists with the ID: ${secret.id}`);
                        }

                        return secretFactory.create(request.payload);
                    })
                    .then((secret) => {
                        const location = urlLib.format({
                            host: request.headers.host,
                            port: request.headers.port,
                            protocol: request.server.info.protocol,
                            pathname: `${request.path}/${secret.id}`
                        });
                        const output = secret.toJson();

                        delete output.value;

                        return reply(output).header('Location', location).code(201);
                    });
            })
            // something broke, respond with error
                .catch(err => reply(boom.wrap(err)));
        },
        validate: {
            payload: schema.models.secret.create
        }
    }
});
