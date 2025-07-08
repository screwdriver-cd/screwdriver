'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const getSchema = schema.models.pipeline.base.extract('admins').get;
const idSchema = schema.models.pipeline.base.extract('id');
const scmContextSchema = schema.models.pipeline.base.extract('scmContext');

module.exports = () => ({
    method: 'GET',
    path: '/pipelines/{id}/admin',
    options: {
        description: 'Get the pipeline admin',
        notes: 'Returns a pipeline admin record',
        tags: ['api', 'pipelines'],
        auth: {
            strategies: ['token'],
            scope: ['user', 'pipeline', '!guest']
        },

        handler: async (request, h) => {
            const factory = request.server.app.pipelineFactory;
            const { scmContext, includeUserToken } = request.query;
            const pipeline = await factory.get(request.params.id);

            if (!pipeline) {
                throw boom.notFound('Pipeline does not exist');
            }

            try {
                const admin =
                    scmContext && scmContext !== pipeline.scmContext
                        ? await pipeline.getFirstAdmin({ scmContext })
                        : await pipeline.getFirstAdmin();

                if (includeUserToken) {
                    const profile = request.server.plugins.auth.generateProfile({
                        username: admin.username,
                        scmContext: admin.scmContext,
                        scope: ['user']
                    });

                    admin.userToken = request.server.plugins.auth.generateToken(profile);
                }

                return h.response(admin);
            } catch (e) {
                throw boom.notFound(e);
            }
        },
        response: {
            schema: getSchema
        },
        validate: {
            params: joi.object({
                id: idSchema
            }),
            query: joi.object({
                scmContext: scmContextSchema.optional(),
                includeUserToken: joi.boolean().optional()
            })
        }
    }
});
