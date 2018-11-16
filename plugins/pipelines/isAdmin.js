'use strict';

const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const idSchema = joi.reach(schema.models.pipeline.base, 'id');

module.exports = () => ({
    method: 'GET',
    path: '/pipelines/{id}/isAdmin',
    config: {
        description: 'Check if a user is admin of a single pipeline',
        notes: 'Returns true or false',
        tags: ['api', 'pipelines'],
        auth: {
            strategies: ['token'],
            scope: ['user']
        },
        plugins: {
            'hapi-swagger': {
                security: [{ token: [] }]
            }
        },
        handler: (request, reply) => {
            const id = request.params.id;
            const pipelineFactory = request.server.app.pipelineFactory;
            const userFactory = request.server.app.userFactory;
            const username = request.auth.credentials.username;
            const scmContext = request.auth.credentials.scmContext;

            return Promise.all([
                pipelineFactory.get({ id }),
                userFactory.get({ username, scmContext })
            ])
                // get the pipeline given its ID and the user
                .then(([pipeline, user]) => {
                    if (!pipeline) {
                        throw boom.notFound(`Pipeline ${id} does not exist`);
                    }

                    // ask the user for permissions on this repo
                    return user.getPermissions(pipeline.scmUri)
                        .then(permissions => reply(permissions.admin));
                })
                // something broke, respond with error
                .catch(err => reply(boom.boomify(err)));
        },
        validate: {
            params: {
                id: idSchema
            }
        }
    }
});
