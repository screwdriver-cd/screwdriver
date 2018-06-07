'use strict';

const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const idSchema = joi.reach(schema.models.pipeline.base, 'id');

module.exports = () => ({
    method: 'POST',
    path: '/pipelines/{id}/startall',
    config: {
        description: 'Start all child pipelines given a specific pipeline',
        notes: 'Start all child pipelines given a specific pipeline',
        tags: ['api', 'pipelines'],
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
            const pipelineFactory = request.server.app.pipelineFactory;
            const eventFactory = request.server.app.eventFactory;
            const userFactory = request.server.app.userFactory;
            const id = request.params.id;
            const username = request.auth.credentials.username;
            const scmContext = request.auth.credentials.scmContext;
            const scm = pipelineFactory.scm;

            return Promise.all([
                pipelineFactory.get(id),
                userFactory.get({ username, scmContext })
            ])
                .then(([pipeline, user]) => {
                    if (!pipeline) {
                        throw boom.notFound('Pipeline does not exist');
                    }

                    return user.getPermissions(pipeline.scmUri)
                        // check if user has push access
                        .then((permissions) => {
                            if (!permissions.push) {
                                throw boom.unauthorized(`User ${username} `
                                    + 'does not have push permission for this repo');
                            }
                        });
                })
                .then(() => pipelineFactory.list({
                    params: {
                        configPipelineId: id
                    }
                }))
                .then(pipelines => pipelines.map(p =>
                    p.token.then(token => scm.getCommitSha({
                        scmContext,
                        scmUri: p.scmUri,
                        token
                    }))
                        .then(sha => eventFactory.create({
                            pipelineId: p.id,
                            sha,
                            username,
                            scmContext,
                            startFrom: '~commit',
                            causeMessage: `Started by ${username}`
                        }))))
                .then(() => reply().code(201))
                .catch(err => reply(boom.wrap(err)));
        },
        validate: {
            params: {
                id: idSchema
            }
        }
    }
});
