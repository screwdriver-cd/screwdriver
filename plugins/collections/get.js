'use strict';

const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const winston = require('winston');
const getSchema = schema.models.collection.get;
const idSchema = joi.reach(schema.models.collection.base, 'id');

/**
 * Helper function to get PR info of pipeline
 *
 * @param   {Pipeline} pipeline  Pipeline model to get PR info for
 * @returns {Object}
 */
function getPipelinePRInfo(pipeline) {
    const prs = {
        open: 0,
        failing: 0
    };

    // Get all the PR jobs
    return pipeline.getJobs({ type: 'pr' })
        .then((prJobs) => {
            if (!prJobs) {
                return prs;
            }

            // Return array of prJobs' builds
            return Promise.all(prJobs.map(job =>
                job.getBuilds()
            ));
        })
        .then((prJobsBuilds) => {
            if (!prJobsBuilds || !prJobsBuilds.length) {
                return prs;
            }

            // prJobsBuilds is a 2D array where each element is an array of builds
            // for one PR job.
            prs.open = prJobsBuilds.length;

            prJobsBuilds.forEach((jobBuilds) => {
                // Check the first element (last build) if pr job failed
                if (jobBuilds[0].status === 'FAILURE') {
                    prs.failing += 1;
                }
            });

            return prs;
        })
        .catch((err) => {
            winston.error(err);

            return prs;
        });
}

/**
 * Helper function to get last builds of pipeline
 *
 * @param   {Object}  pipeline      Pipeline to get last builds for
 * @param   {Factory} eventFactory  Factory for getting last event model
 * @returns {Object}
 */
function getPipelineHealth(pipeline, eventFactory) {
    let lastBuilds = [];

    if (!pipeline.lastEventId) {
        return lastBuilds;
    }

    return eventFactory.get(pipeline.lastEventId)
        .then((event) => {
            if (!event) {
                return lastBuilds;
            }

            return event.getBuilds()
                .then((builds) => {
                    if (builds.length) {
                        // The events are sorted by most recent first. Need to reverse the order
                        // to allow for matching with workflow job on the UI
                        lastBuilds = builds.map(b => b.toJson()).reverse();
                    }

                    return lastBuilds;
                });
        })
        .catch((err) => {
            winston.error(err);

            return lastBuilds;
        });
}

/**
 * Helper function to populate pipelines with last builds and pr info
 *
 * @param   {Array}   pipelines    Array of pipeline models to get last builds for
 * @param   {Factory} eventFactory Factory for getting last event model
 * @returns {Array}
 */
function getPipelinesInfo(pipelines, eventFactory) {
    return pipelines
        // Filter out pipelines that don't exist
        .filter(pipeline => !!pipeline)
        .map(pipeline =>
            // Get the PR Info and last builds for each pipeline
            Promise.all([
                getPipelinePRInfo(pipeline),
                getPipelineHealth(pipeline, eventFactory)
            ])
                // Combine the PR Info and last builds and return the populated pipeline
                .then(([pipelinePRInfo, pipelineHealth]) => {
                    const result = Object.assign({}, pipeline.toJson());

                    result.prs = pipelinePRInfo;
                    result.lastBuilds = pipelineHealth;

                    return result;
                })
        );
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
                        // Populate pipelines with PR Info and then last builds
                        .then(pipelines => Promise.all(getPipelinesInfo(pipelines, eventFactory)))
                        .then((pipelinesWithInfo) => {
                            const result = Object.assign({}, collection.toJson());

                            result.pipelines = pipelinesWithInfo;
                            // pipelineIds should only contain pipelines that exist
                            result.pipelineIds = pipelinesWithInfo.map(p => p.id);
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
