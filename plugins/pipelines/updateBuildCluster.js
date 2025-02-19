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
            const { id } = request.params;


            // payload should have buildCluster annotation
            if (!payload[buildClusterAnnotation]) {
                throw boom.badRequest(`Payload must contain ${buildClusterAnnotation}`);
            }

            console.log("id: ", id);
            console.log("payload: ", payload);
            const { pipelineFactory, bannerFactory } = request.server.app;
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
                    `User ${adminDetails.userDisplayName} does not have Screwdriver administrative privileges to update the buildCluster`
                );
            }   

            const pipeline = await pipelineFactory.get({ id });
            // check if pipeline is null
            if (!pipeline) {                
                throw boom.notFound(`Pipeline ${id} does not exist`);
            }

            console.log("pipeline: ", pipeline);
            const pipelineConfig = await pipeline.getConfiguration({});

            // check if pipeline has buildCluster annotation
            if (pipelineConfig.annotations?.[buildClusterAnnotation]) {
                const scmUrl = pipeline.scmRepo.url;
                throw boom.conflict(`Pipeline ${id} already has a buildCluster annotation set in the YAML configuration: check ${scmUrl}`);
            }

            // need to make sure that the buildCluster is a valid cluster

            // update pipeline with buildCluster annotation
            pipeline.annotations[buildClusterAnnotation] = payload[buildClusterAnnotation];
            try {
                const result = await pipeline.update();
                logger.info(
                    `[Audit] user ${username} updates ${buildClusterAnnotation} for pipelineID:${id} to ${payload[buildClusterAnnotation]}.`
                );
                return h.response(result.toJson()).code(200);
            } catch (err) {
                logger.error(`Failed to update ${buildClusterAnnotation} for pipeline ${id}: ${err.message}`);
                throw boom.internal(`Failed to update pipeline ${id}`);
            }
        },
        validate: {
            params: joi.object({
                id: idSchema
            })
        }
    }
});
