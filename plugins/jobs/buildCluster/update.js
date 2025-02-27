'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const logger = require('screwdriver-logger');
const idSchema = schema.models.job.base.extract('id');

module.exports = () => ({
    method: 'PUT',
    path: '/jobs/{id}/buildCluster',
    options: {
        description: 'Update the buildCluster of a job',
        notes: 'Update the buildCluster of a specific job',
        tags: ['api', 'jobs'],
        auth: {
            strategies: ['token'],
            scope: ['admin', '!guest']
        },
        handler: async (request, h) => {
            const adminAnnotation = 'screwdriver.cd/sdAdminBuildClusterOverride';
            const { payload } = request;
            const { id } = request.params;

            if (!payload[adminAnnotation]) {
                throw boom.badRequest(`Payload must contain ${adminAnnotation}`);
            }

            const { jobFactory, buildClusterFactory, pipelineFactory } = request.server.app;
            const { scmContext, username } = request.auth.credentials;

            const job = await jobFactory.get(id);

            if (!job) {
                throw boom.notFound(`Job ${id} does not exist`);
            }

            const pipeline = await pipelineFactory.get(job.pipelineId);

            if (!pipeline) {
                throw boom.notFound('Pipeline does not exist');
            }

            // ensure that the buildCluster is a valid cluster
            const buildClusterName = payload[adminAnnotation];
            const buildCluster = await buildClusterFactory.get({ name: buildClusterName, scmContext });

            if (!buildCluster || !buildCluster.isActive) {
                throw boom.badRequest(`Build cluster ${buildClusterName} does not exist or is not active`);
            }

            // update job with buildClusterOverride annotation
            const [permutation] = job.permutations;

            permutation.annotations = permutation.annotations || {};

            const annotations = permutation.annotations;

            if (annotations[adminAnnotation]) {
                logger.info(
                    `[Audit] ${adminAnnotation} for jobId:${id} already set to ${annotations[adminAnnotation]}, updating.`
                );
            }
            permutation.annotations[adminAnnotation] = buildClusterName;
            job.stateChanger = username;
            job.stateChangeTime = new Date().toISOString();

            try {
                const result = await job.update();

                logger.info(
                    `[Audit] user ${username} updates ${adminAnnotation} for jobId:${id} to ${buildClusterName}.`
                );

                return h.response(result.toJson()).code(200);
            } catch (err) {
                logger.error(`Failed to update ${adminAnnotation} for job ${id}: ${err.message}`);
                throw boom.internal(`Failed to update ${adminAnnotation} for job ${id}`);
            }
        },
        validate: {
            params: joi.object({
                id: idSchema
            })
        }
    }
});
