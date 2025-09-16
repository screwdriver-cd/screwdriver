'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const idSchema = schema.models.pipeline.base.extract('id');
const { updatePipelineAdmins } = require('./helper/updateAdmins');

module.exports = () => ({
    method: 'PUT',
    path: '/pipelines/{id}/updateAdmins',
    options: {
        description: 'Update admins of a pipeline',
        notes: 'Update the admins of a specific pipeline',
        tags: ['api', 'pipelines'],
        auth: {
            strategies: ['token'],
            scope: ['user', '!guest', 'admin']
        },
        handler: async (request, h) => {
            const { id } = request.params;
            const { scmContext, username, scope } = request.auth.credentials;

            const { usernames } = request.payload;
            const payloadScmContext = request.payload.scmContext;

            if (!Array.isArray(usernames) || usernames.length === 0) {
                throw boom.badRequest(`Payload must contain admin usernames`);
            } else if (!payloadScmContext) {
                throw boom.badRequest(`Payload must contain scmContext`);
            }

            const { userFactory } = request.server.app;

            const isSDAdmin = scope.includes('admin');

            const user = await userFactory.get({ username, scmContext });

            const updatedPipeline = await updatePipelineAdmins(
                {
                    id,
                    scmContext: payloadScmContext,
                    usernames
                },
                user,
                isSDAdmin,
                request.server
            );

            return h.response(updatedPipeline.toJson()).code(200);
        },
        validate: {
            params: joi.object({
                id: idSchema
            })
        }
    }
});
