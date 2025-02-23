'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const logger = require('screwdriver-logger');
const idSchema = schema.models.pipeline.base.extract('id');

module.exports = () => ({
    method: 'PUT',
    path: '/pipelines/{id}/buildCluster',
    options: {
        description: 'Update the buildCluster of a pipeline',
        notes: 'Update the buildCluster of a specific pipeline',
        tags: ['api', 'pipelines'],
        auth: {
            strategies: ['token'],
            scope: ['user', '!guest']
        },
        handler: async (request, h) => {
            const buildClusterAnnotation = 'screwdriver.cd/buildCluster';
            const payload = request.payload;

            // payload should have buildCluster annotation
            if (!payload[buildClusterAnnotation]) {
                throw boom.badRequest(`Payload must contain ${buildClusterAnnotation}`);
            }

            const { pipelineFactory, bannerFactory, buildClusterFactory } = request.server.app;
            const { scmContext, username, scmUserId } = request.auth.credentials;

            // only SD cluster admins can update the buildCluster
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

            const { id } = request.params;
            const pipeline = await pipelineFactory.get({ id });
            // check if pipeline exists
            if (!pipeline) {                
                throw boom.notFound(`Pipeline ${id} does not exist`);
            }

            const pipelineConfig = await pipeline.getConfiguration({});
            // check if pipeline has buildCluster annotation
            if (pipelineConfig.annotations?.[buildClusterAnnotation]) {
                const scmUrl = pipeline.scmRepo.url;
                throw boom.conflict(`Pipeline ${id} already has a buildCluster annotation set in the YAML configuration: check ${scmUrl}`);
            }

            // ensure that the buildCluster is a valid cluster
            const buildClusterName = payload[buildClusterAnnotation];
            const buildCluster = await buildClusterFactory.get({ name: buildClusterName, scmContext });
            if (!buildCluster) {
                throw boom.badRequest(`Build cluster ${buildClusterName} does not exist`);
            }

            // ensure that the buildCluster is active
            if (!buildCluster.isActive) { 
                throw boom.badRequest(`Build cluster ${buildClusterName} is not active`);
            }

            // update pipeline with buildCluster annotation
            if (!pipeline.annotations) {
                pipeline.annotations = {};
            }
            pipeline.annotations[buildClusterAnnotation] = buildClusterName;
            try {
                const result = await pipeline.update();
                logger.info(
                    `[Audit] user ${username} updates ${buildClusterAnnotation} for pipelineID:${id} to ${buildClusterName}.`
                );
                return h.response(result.toJson()).code(200);
            } catch (err) {
                logger.error(`Failed to update ${buildClusterAnnotation} for pipeline ${id}: ${err.message}`);
                throw boom.internal(`Failed to update ${buildClusterAnnotation} for pipeline ${id}`);
            }
        },
        validate: {
            params: joi.object({
                id: idSchema
            })
        }
    }
});
