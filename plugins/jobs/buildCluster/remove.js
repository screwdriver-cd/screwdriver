'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const logger = require('screwdriver-logger');
const idSchema = schema.models.job.base.extract('id');

module.exports = () => ({
    method: 'DELETE',
    path: '/jobs/{id}/buildCluster',
    options: {
        description: 'Delete the buildCluster override of a job',
        notes: 'Returns null if successful',
        tags: ['api', 'jobs'],
        auth: {
            strategies: ['token'],
            scope: ['user', '!guest']
        },

        handler: async (request, h) => {
            const { jobFactory, bannerFactory, userFactory, pipelineFactory } = request.server.app;
            const { username, scmContext, scmUserId } = request.auth.credentials;
            const { id } = request.params;
            const adminAnnotation = 'screwdriver.cd/sdAdminBuildClusterOverride';
            const job = await jobFactory.get(id);

            if (!job) {
                throw boom.notFound(`Job ${id} does not exist`);
            }

            const [pipeline, user] = await Promise.all([
                pipelineFactory.get(job.pipelineId),
                userFactory.get({ username, scmContext })
            ]);

            if (!pipeline) {
                throw boom.notFound('Pipeline does not exist');
            }

            if (!user) {
                throw boom.notFound(`User ${username} does not exist`);
            }

            const scmDisplayName = bannerFactory.scm.getDisplayName({ scmContext });
            const adminDetails = request.server.plugins.banners.screwdriverAdminDetails(
                username,
                scmDisplayName,
                scmUserId
            );

            if (!adminDetails.isAdmin) {
                throw boom.forbidden(
                    `User ${username} does not have Screwdriver administrative privileges to update the buildCluster`
                );
            }

            // remove buildClusterOverride annotation from job
            const [permutation] = job.permutations;
            const buildClusterOverride =
                permutation && permutation.annotations && permutation.annotations[adminAnnotation];

            if (!buildClusterOverride) {
                logger.info(`[Audit] ${adminAnnotation} does not exists for jobId:${id}.`);

                return h.response().code(204);
            }

            logger.info(`[Audit] ${adminAnnotation} for jobId:${id} set to ${buildClusterOverride}, deleting.`);

            delete permutation.annotations[adminAnnotation];

            job.stateChanger = username;
            job.stateChangeTime = new Date().toISOString();

            try {
                const result = await job.update();

                logger.info(`[Audit] user ${username} deleted ${adminAnnotation} for jobId:${id}.`);

                return h.response(result.toJson()).code(200);
            } catch (err) {
                logger.error(`Failed to remove ${adminAnnotation} for job ${id}: ${err.message}`);
                throw boom.internal(`Failed to remove ${adminAnnotation} for job ${id}`);
            }
        },
        validate: {
            params: joi.object({
                id: idSchema
            })
        }
    }
});
