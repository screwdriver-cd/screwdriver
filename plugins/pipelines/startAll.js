'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const { getUserPermissions, handleUserPermissions } = require('../helper.js');
const idSchema = schema.models.pipeline.base.extract('id');

module.exports = () => ({
    method: 'POST',
    path: '/pipelines/{id}/startall',
    options: {
        description: 'Start all child pipelines given a specific pipeline',
        notes: 'Start all child pipelines given a specific pipeline',
        tags: ['api', 'pipelines'],
        auth: {
            strategies: ['token'],
            scope: ['user', '!guest']
        },

        handler: async (request, h) => {
            const { pipelineFactory, eventFactory, userFactory } = request.server.app;
            const { username, scmContext } = request.auth.credentials;
            const { id } = request.params;
            const { scm } = pipelineFactory;

            const pipeline = await pipelineFactory.get(id);
            const user = await userFactory.get({ username, scmContext });

            if (!pipeline) {
                throw boom.notFound('Pipeline does not exist');
            }

            await getUserPermissions({ user, scmUri: pipeline.scmUri });

            const pipelines = await pipelineFactory.list({
                params: {
                    configPipelineId: id
                }
            });

            return pipelines
                .map(async p => {
                    const { pipelineUsername, pipelineToken, pipelineScmContext } = handleUserPermissions({
                        user,
                        userFactory,
                        pipeline,
                        permissionsOnly: false
                    });
                    const sha = await scm.getCommitSha({
                        scmContext: pipelineScmContext,
                        scmUri: p.scmUri,
                        token: pipelineToken
                    });

                    return eventFactory.create({
                        pipelineId: p.id,
                        sha,
                        username: pipelineUsername,
                        scmContext: pipelineScmContext,
                        startFrom: '~commit',
                        causeMessage: `Started by ${pipelineUsername}`
                    });
                })
                .then(() => h.response().code(201))
                .catch(err => {
                    throw err;
                });
        },
        validate: {
            params: joi.object({
                id: idSchema
            })
        }
    }
});
