'use strict';

const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const getSchema = schema.models.collection.get;
const idSchema = joi.reach(schema.models.collection.base, 'id');

/**
 * Helper function to get last builds of pipelines
 *
 * @param   {Array}    pipelines     - array of pipeline models to get last builds for
 * @param   {Factory}  eventFactory  - factory for getting last event model
 * @returns {Array}
 */
function getPipelinesHealth(pipelines, eventFactory) {
    return pipelines
        .filter(pipeline => !!pipeline)
        .map((pipeline) => {
            const result = Object.assign({}, pipeline.toJson());

            if (!pipeline.lastEventId) {
                return result;
            }

            return eventFactory.get(pipeline.lastEventId)
                .then((event) => {
                    if (!event) {
                        return result;
                    }

                    return event.getBuilds()
                        .then((builds) => {
                            if (builds.length) {
                                result.lastBuilds = builds.map(b => b.toJson());
                            }

                            return result;
                        });
                })
                .catch(() => result);
        });
}

module.exports = () => ({
    method: 'GET',
    path: '/collections/{id}',
    config: {
        description: 'Get a single collection',
        notes: 'Returns a collection record',
        tags: ['api', 'collections'],
        handler: (request, reply) => {
            const { collectionFactory, pipelineFactory, eventFactory } = request.server.app;

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
                        .then(pipelines => Promise.all(getPipelinesHealth(pipelines, eventFactory)))
                        .then((pipelinesWithHealth) => {
                            const result = Object.assign({}, collection.toJson());

                            result.pipelines = pipelinesWithHealth;
                            // pipelineIds should only contain pipelines that exist
                            result.pipelineIds = pipelinesWithHealth.map(p => p.id);
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
