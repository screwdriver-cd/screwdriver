'use strict';

const schema = require('screwdriver-data-schema');
const joi = require('joi');
const idSchema = schema.models.pipeline.base.extract('id');
const scmContextSchema = schema.models.pipeline.base.extract('scmContext');
const usernameSchema = schema.models.user.base.extract('username');
const { batchUpdatePipelineAdmins } = require('./helper/updateAdmins');

module.exports = () => ({
    method: 'PUT',
    path: '/pipelines/updateAdmins',
    options: {
        description: 'Update admins for a collection of pipelines',
        notes: 'Update the admins for a collection of pipelines',
        tags: ['api', 'pipelines'],
        auth: {
            strategies: ['token'],
            scope: ['user', '!guest', 'admin']
        },
        handler: async (request, h) => {
            const { scmContext, username, scope } = request.auth.credentials;
            const { payload } = request;
            const { userFactory } = request.server.app;
            const isSDAdmin = scope.includes('admin');
            const user = await userFactory.get({ username, scmContext });

            await batchUpdatePipelineAdmins(payload, user, isSDAdmin, request.server);

            return h.response().code(204);
        },
        validate: {
            payload: joi
                .array()
                .items(
                    joi.object({
                        id: idSchema.required(),
                        scmContext: scmContextSchema.required(),
                        usernames: joi.array().items(usernameSchema).min(1).max(200).required()
                    })
                )
                .min(1)
        }
    }
});
