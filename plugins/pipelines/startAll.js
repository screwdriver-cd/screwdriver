'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const idSchema = schema.models.pipeline.base.extract('id');

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
        handler: (request, h) => {
            const { pipelineFactory, eventFactory, userFactory } = request.server.app;
            const { username, scmContext } = request.auth.credentials;
            const { id } = request.params;
            const { scm } = pipelineFactory;

            return Promise.all([pipelineFactory.get(id), userFactory.get({ username, scmContext })])
                .then(([pipeline, user]) => {
                    if (!pipeline) {
                        throw boom.notFound('Pipeline does not exist');
                    }

                    return (
                        user
                            .getPermissions(pipeline.scmUri)
                            // check if user has push access
                            .then(permissions => {
                                if (!permissions.push) {
                                    throw boom.forbidden(
                                        `User ${username} does not have push permission for this repo`
                                    );
                                }
                            })
                    );
                })
                .then(() =>
                    pipelineFactory.list({
                        params: {
                            configPipelineId: id
                        }
                    })
                )
                .then(pipelines =>
                    pipelines.map(p =>
                        p.token
                            .then(token =>
                                scm.getCommitSha({
                                    scmContext,
                                    scmUri: p.scmUri,
                                    token
                                })
                            )
                            .then(sha =>
                                eventFactory.create({
                                    pipelineId: p.id,
                                    sha,
                                    username,
                                    scmContext,
                                    startFrom: '~commit',
                                    causeMessage: `Started by ${username}`
                                })
                            )
                    )
                )
                .then(() => h.response().code(201))
                .catch(err => h.response(boom.boomify(err)));
        },
        validate: {
            params: joi.object({
                id: idSchema
            })
        }
    }
});
