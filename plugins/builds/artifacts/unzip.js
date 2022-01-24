'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const idSchema = schema.models.build.base.extract('id');

module.exports = config => ({
    method: 'POST',
    path: '/builds/{id}/artifacts/unzip',
    options: {
        description: 'Extract a ZIP for build artifacts',
        notes: 'Extract a specific ZIP for build artifacts',
        tags: ['api', 'builds', 'artifacts'],
        auth: {
            strategies: ['token'],
            scope: ['build']
        },

        handler: async (req, h) => {
            if (!req.server.app.feature.unzipArtifacts) {
                const data = {
                    statusCode: 200,
                    message: "This function is not enabled and will do nothing."
                }
                return h.response(data).code(200);
            }
            const buildId = req.params.id;
            const { username, scope } = req.auth.credentials;
            const isBuild = scope.includes('build');
            const { buildFactory } = req.server.app;

            if (isBuild && username !== buildId) {
                return boom.forbidden(`Credential only valid for ${username}`);
            }

            return buildFactory
                .get(buildId)
                .then(async buildModel => {
                    if (!buildModel) {
                        throw boom.notFound('Build does not exist');
                    }
                    await buildModel.unzipArtifacts();
                    return h.response().code(202);
                })
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
