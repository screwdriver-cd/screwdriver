'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const getSchema = joi.array().items(schema.models.token.get);
const pipelineIdSchema = schema.models.pipeline.base.extract('id');
const { getUserPermissions, getScmUri } = require('../../helper');

module.exports = () => ({
    method: 'GET',
    path: '/pipelines/{id}/tokens',
    options: {
        description: 'List tokens for pipeline',
        notes: 'List tokens for a specific pipeline',
        tags: ['api', 'tokens'],
        auth: {
            strategies: ['token'],
            scope: ['user', '!guest']
        },

        handler: async (request, h) => {
            const { pipelineFactory, userFactory } = request.server.app;
            const { username, scmContext } = request.auth.credentials;

            const [pipeline, user] = await Promise.all([
                pipelineFactory.get(request.params.id),
                userFactory.get({ username, scmContext })
            ]);

            if (!pipeline) {
                throw boom.notFound('Pipeline does not exist');
            }

            if (!user) {
                throw boom.notFound('User does not exist');
            }

            // Use parent's scmUri if pipeline is child pipeline and using read-only SCM
            const scmUri = await getScmUri({ pipeline, pipelineFactory });

            // Check the user's permission
            await getUserPermissions({ user, scmUri });

            return pipeline.tokens
                .then(tokens =>
                    h.response(
                        tokens.map(token => {
                            const output = token.toJson();

                            delete output.userId;
                            delete output.pipelineId;

                            return output;
                        })
                    )
                )
                .catch(err => {
                    throw err;
                });
        },
        response: {
            schema: getSchema
        },
        validate: {
            params: joi.object({
                id: pipelineIdSchema
            })
        }
    }
});
