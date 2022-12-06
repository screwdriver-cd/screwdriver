'use strict';

const boom = require('@hapi/boom');
const schema = require('screwdriver-data-schema');
const joi = require('joi');
const idSchema = schema.models.collection.base.extract('id');
const pipelineIdSchema = schema.models.pipeline.base.extract('id');

module.exports = () => ({
    method: 'PUT',
    path: '/collections/{id}/pipelines/{pipelineId}',
    options: {
        description: 'Add a pipeline to the collection',
        notes: 'Returns null if successful',
        tags: ['api', 'collections'],
        auth: {
            strategies: ['token'],
            scope: ['user', '!guest']
        },

        handler: async (request, h) => {
            const { collectionFactory, pipelineFactory, userFactory } = request.server.app;
            const { username, scmContext } = request.auth.credentials;
            const { id, pipelineId } = request.params;

            // Fetch the collection and user models
            return Promise.all([
                collectionFactory.get(id),
                pipelineFactory.get(pipelineId),
                userFactory.get({ username, scmContext })
            ])
                .then(([collection, pipeline, user]) => {
                    if (!collection) {
                        throw boom.notFound(`Collection ${id} does not exist`);
                    }
                    if (!pipeline) {
                        throw boom.notFound(`Pipeline ${pipelineId} does not exist`);
                    }
                    if (!user) {
                        throw boom.notFound(`User ${username} does not exist`);
                    }
                    if (collection.userId !== user.id) {
                        throw boom.forbidden(`User ${username} does not own collection`);
                    }

                    collection.pipelineIds = [...collection.pipelineIds, pipelineId];

                    return collection.update().then(() => h.response().code(204));
                })
                .catch(err => {
                    throw err;
                });
        },
        validate: {
            params: joi.object({
                id: idSchema,
                pipelineId: pipelineIdSchema
            })
        }
    }
});
