'use strict';

const boom = require('@hapi/boom');
const schema = require('screwdriver-data-schema');
const joi = require('joi');
const idSchema = schema.models.collection.base.extract('id');
const pipelineIdSchema = schema.models.pipeline.base.extract('id');
const pipelineIdsSchema = joi.alternatives().try(joi.array().items(pipelineIdSchema), pipelineIdSchema).required();
const IDS_KEY = 'ids[]';

module.exports = () => ({
    method: 'DELETE',
    path: '/collections/{id}/pipelines',
    options: {
        description: 'Delete one or more pipelines from a collection',
        notes: 'Returns null if successful',
        tags: ['api', 'collections'],
        auth: {
            strategies: ['token'],
            scope: ['user', '!guest']
        },

        handler: async (request, h) => {
            const { collectionFactory, userFactory } = request.server.app;
            const { username, scmContext } = request.auth.credentials;
            const { id } = request.params;

            // Fetch the collection and user models
            return Promise.all([collectionFactory.get(request.params.id), userFactory.get({ username, scmContext })])
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

                    // Only return specific pipelines
                    const pipelineIdsQueryParam = request.query[IDS_KEY];

                    if (pipelineIdsQueryParam) {
                        const pipelineIdsToRemove = Array.isArray(pipelineIdsQueryParam)
                            ? pipelineIdsQueryParam.map(pipelineId => parseInt(pipelineId, 10))
                            : [parseInt(pipelineIdsQueryParam, 10)];

                        collection.pipelineIds = collection.pipelineIds.filter(i => !pipelineIdsToRemove.includes(i));
                    } else {
                        collection.pipelineIds = [];
                    }

                    return collection.update().then(() => h.response().code(204));
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
