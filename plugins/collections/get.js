'use strict';

const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const getSchema = schema.models.collection.get;
const idSchema = joi.reach(schema.models.collection.base, 'id');

module.exports = () => ({
    method: 'GET',
    path: '/collections/{id}',
    config: {
        description: 'Get a single collection',
        notes: 'Returns a collection record',
        tags: ['api', 'collections'],
        handler: (request, reply) => {
            const { collectionFactory, pipelineFactory } = request.server.app;

            return collectionFactory.get(request.params.id)
                .then((collection) => {
                    if (!collection) {
                        throw boom.notFound('Collection does not exist');
                    }

                    // Store promises from pipelineFactory fetch operations
                    const collectionPipelines = [];

                    collection.pipelineIds.forEach((id) => {
                        collectionPipelines.push(pipelineFactory.get(id));
                    });

                    return Promise.all(collectionPipelines)
                        .then((pipelines) => {
                            const result = Object.assign({}, collection.toJson());

                            // Iterate over all the fetched pipelines, skip if null
                            // else add it to the result object
                            result.pipelines = pipelines.reduce((accumulator, current) => {
                                if (current) {
                                    accumulator.push(current.toJson());
                                }

                                return accumulator;
                            }, []);
                            delete result.pipelineIds;
                            delete result.userId;

                            return reply(result);
                        });
                })
                .catch(err => reply(boom.wrap(err)));
        },
        response: {
            schema: getSchema
        },
        validate: {
            params: {
                id: idSchema
            }
        }
    }
});
