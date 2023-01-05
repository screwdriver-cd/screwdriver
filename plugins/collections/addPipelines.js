'use strict';

const boom = require('@hapi/boom');
const schema = require('screwdriver-data-schema');
const joi = require('joi');
const idSchema = schema.models.collection.base.extract('id');
const pipelineIdSchema = schema.models.pipeline.base.extract('id');
const pipelineIdsSchema = joi.alternatives().try(joi.array().items(pipelineIdSchema), pipelineIdSchema).required();
const IDS_KEY = 'ids[]';

module.exports = () => ({
    method: 'PUT',
    path: '/collections/{id}/pipelines',
    options: {
        description: 'Add one or more pipelines to the collection',
        notes: 'Returns null if successful',
        tags: ['api', 'collections'],
        auth: {
            strategies: ['token'],
            scope: ['user', '!guest']
        },

        handler: async (request, h) => {
            const { collectionFactory, pipelineFactory, userFactory } = request.server.app;
            const { username, scmContext } = request.auth.credentials;
            const { id } = request.params;

            // Fetch the collection and user models
            return Promise.all([collectionFactory.get(id), userFactory.get({ username, scmContext })])
                .then(([collection, user]) => {
                    if (!collection) {
                        throw boom.notFound(`Collection ${id} does not exist`);
                    }
                    if (!user) {
                        throw boom.notFound(`User ${username} does not exist`);
                    }
                    if (collection.userId !== user.id) {
                        throw boom.forbidden(`User ${username} does not own collection`);
                    }

                    const pipelineIdsQueryParam = request.query[IDS_KEY];

                    if (!pipelineIdsQueryParam) {
                        throw boom.notFound(`Pipelines are not provided to add to the collection`);
                    }

                    const pipelineIdsToAdd = Array.isArray(pipelineIdsQueryParam)
                        ? pipelineIdsQueryParam.map(pipelineId => parseInt(pipelineId, 10))
                        : [parseInt(pipelineIdsQueryParam, 10)];

                    return pipelineFactory
                        .list({
                            params: {
                                scmContext,
                                id: pipelineIdsToAdd
                            }
                        })
                        .then(pipelinesToAdd => {
                            const newPipelineIdsToAdd = pipelinesToAdd
                                .filter(p => !collection.pipelineIds.includes(p.id))
                                .map(p => p.id);

                            collection.pipelineIds = [...collection.pipelineIds, ...newPipelineIdsToAdd];

                            return collection.update().then(() => h.response().code(204));
                        });
                })
                .catch(err => {
                    throw err;
                });
        },
        validate: {
            params: joi.object({
                id: idSchema,
                'ids[]': pipelineIdsSchema.optional()
            })
        }
    }
});
