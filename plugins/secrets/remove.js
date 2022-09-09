'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const logger = require('screwdriver-logger');
const idSchema = schema.models.secret.base.extract('id');

module.exports = () => ({
    method: 'DELETE',
    path: '/secrets/{id}',
    options: {
        description: 'Remove a single secret',
        notes: 'Returns null if successful',
        tags: ['api', 'secrets'],
        auth: {
            strategies: ['token'],
            scope: ['user', '!guest', 'pipeline']
        },

        handler: async (request, h) => {
            const { secretFactory } = request.server.app;
            const { credentials } = request.auth;
            const { canAccess } = request.server.plugins.secrets;

            // Get the secret first
            return secretFactory
                .get(request.params.id)
                .then(secret => {
                    if (!secret) {
                        throw boom.notFound('Secret does not exist');
                    }

                    // Make sure that user has permission before deleting
                    return canAccess(credentials, secret, 'admin', request.server.app)
                    .then(() => { 
                        logger.info(`[Audit] user ${credentials.username}:${credentials.scmContext} deletes the secret key:${secret.name} from pipelineId:${secret.pipelineId}.`);
                        secret.remove();
                    })
                        .then(() => h.response().code(204));
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
