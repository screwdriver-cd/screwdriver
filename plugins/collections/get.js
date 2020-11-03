'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const getSchema = schema.models.collection.get;
const idSchema = schema.models.collection.base.extract('id');

module.exports = () => ({
    method: 'GET',
    path: '/collections/{id}',
    options: {
        description: 'Get a single collection',
        notes: 'Returns a collection record',
        tags: ['api', 'collections'],
        auth: {
            strategies: ['token'],
            scope: ['user', '!guest']
        },
        plugins: {
            'hapi-swagger': {
                security: [{ token: [] }]
            }
        },
        handler: async (request, h) => {
            const { collectionFactory, pipelineFactory, userFactory } = request.server.app;
            const { username, scmContext } = request.auth.credentials;

            return Promise.all([collectionFactory.get(request.params.id), userFactory.get({ username, scmContext })])
                .then(([collection, user]) => {
                    if (!collection) {
                        throw boom.notFound('Collection does not exist');
                    }

                    const result = { ...collection.toJson() };

                    if (user.id !== result.userId) {
                        // If the user accessing this collection is not the owner, return shared as type
                        result.type = 'shared';
                    } else if (!result.type) {
                        // If the collection type is empty, return normal as type
                        result.type = 'normal';
                    }

                    // Store promises from pipelineFactory fetch operations
                    const collectionPipelines = [];

                    result.pipelineIds.forEach(id => {
                        collectionPipelines.push(pipelineFactory.get(id));
                    });

                    return (
                        Promise.all(collectionPipelines)
                            // to filter out null
                            .then(pipelines => pipelines.filter(pipeline => pipeline))
                            .then(pipelines => {
                                result.pipelines = pipelines;
                                // pipelineIds should only contain pipelines that exist
                                result.pipelineIds = pipelines.map(p => p.id);
                                delete result.userId;

                                return h.response(result);
                            })
                    );
                })
                .catch(err => {
                    throw err;
                });
        },
        response: {
            schema: getSchema
        },
        validate: {
            params: joi.object({
                id: idSchema
            })
        }
    }
});
