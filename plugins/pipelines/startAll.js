'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const { getUserPermissions } = require('../helper');
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

            if (!pipeline) {
                throw boom.notFound('Pipeline does not exist');
            }

            const user = await userFactory.get({ username, scmContext });

            await getUserPermissions({ user, scmUri: pipeline.scmUri, level: 'push' });

            const pipelines = await pipelineFactory.list({
                params: {
                    configPipelineId: id
                }
            });

            await Promise.all(
                pipelines.map(async p => {
                    const pipelineToken = await p.token;
                    const pipelineScmContext = p.scmContext;
                    const sha = await scm.getCommitSha({
                        scmContext: pipelineScmContext,
                        scmUri: p.scmUri,
                        token: pipelineToken
                    });

                    await eventFactory.create({
                        pipelineId: p.id,
                        sha,
                        username,
                        scmContext: pipelineScmContext,
                        startFrom: '~commit',
                        causeMessage: `Started by ${username}`
                    });
                })
            );

            return h.response().code(201);
        },
        validate: {
            params: joi.object({
                id: idSchema
            })
        }
    }
});
