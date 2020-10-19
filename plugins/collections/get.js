'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const getSchema = schema.models.collection.get;
const idSchema = schema.models.collection.base.extract('id');
const logger = require('screwdriver-logger');

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
    return pipeline
        .getJobs({ type: 'pr' })
        .then(prJobs => {
            if (!prJobs) {
                return prs;
            }

            // Return array of prJobs' builds
            return Promise.all(prJobs.map(job => job.getBuilds()));
        })
        .then(prJobsBuilds => {
            if (!prJobsBuilds || !prJobsBuilds.length) {
                return prs;
            }

            // prJobsBuilds is a 2D array where each element is an array of builds
            // for one PR job.
            prs.open = prJobsBuilds.length;

            prJobsBuilds.forEach(jobBuilds => {
                // Check the first element (last build) if pr job failed
                if (Array.isArray(jobBuilds) && typeof jobBuilds[0] === 'object') {
                    if (jobBuilds[0].status === 'FAILURE') {
                        prs.failing += 1;
                    }
                }
            });

            return prs;
        })
        .catch(err => {
            logger.error(err);

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

    return eventFactory
        .get(pipeline.lastEventId)
        .then(event => {
            if (!event) {
                return lastBuilds;
            }

            return event.getBuilds().then(builds => {
                if (builds.length) {
                    // The events are sorted by most recent first. Need to reverse the order
                    // to allow for matching with workflow job on the UI
                    lastBuilds = Promise.all(builds.map(b => b.toJsonWithSteps())).then(bs => bs.reverse());
                }

                return lastBuilds;
            });
        })
        .catch(err => {
            logger.error(err);

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
    return (
        pipelines
            // Filter out pipelines that don't exist
            .filter(pipeline => !!pipeline)
            .map(pipeline =>
                // Get the PR Info and last builds for each pipeline
                Promise.all([getPipelinePRInfo(pipeline), getPipelineHealth(pipeline, eventFactory)])
                    // Combine the PR Info and last builds and return the populated pipeline
                    .then(([pipelinePRInfo, pipelineHealth]) => {
                        const result = { ...pipeline.toJson() };

                        result.prs = pipelinePRInfo;
                        result.lastBuilds = pipelineHealth;

                        return result;
                    })
            )
    );
}

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

        handler: async (request, h) => {
            const { collectionFactory, pipelineFactory, eventFactory, userFactory } = request.server.app;
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
                            // Populate pipelines with PR Info and then last builds
                            .then(pipelines => Promise.all(getPipelinesInfo(pipelines, eventFactory)))
                            .then(pipelinesWithInfo => {
                                result.pipelines = pipelinesWithInfo;
                                // pipelineIds should only contain pipelines that exist
                                result.pipelineIds = pipelinesWithInfo.map(p => p.id);
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
