'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const idSchema = schema.models.job.base.extract('id');
const { getUserPermissions, getScmUri } = require('../helper');

module.exports = () => ({
    method: 'PUT',
    path: '/jobs/{id}',
    options: {
        description: 'Update a job',
        notes: 'Update a specific job',
        tags: ['api', 'jobs'],
        auth: {
            strategies: ['token'],
            scope: ['user', '!guest', 'pipeline']
        },

        handler: async (request, h) => {
            const { jobFactory, pipelineFactory, userFactory } = request.server.app;
            const { id } = request.params;
            const { username, scmContext, scmUserId } = request.auth.credentials;
            const { isValidToken } = request.server.plugins.pipelines;

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

            // In pipeline scope, check if the token is allowed to the pipeline
            if (!isValidToken(pipeline.id, request.auth.credentials)) {
                throw boom.unauthorized('Token does not have permission to this pipeline');
            }

            // Use parent's scmUri if pipeline is child pipeline and using read-only SCM
            const scmUri = await getScmUri({ pipeline, pipelineFactory });

            // Check the user's permission
            const scmDisplayName = scm.getDisplayName({ scmContext });
            const adminDetails = request.server.plugins.banners.screwdriverAdminDetails(
                username,
                scmDisplayName,
                scmUserId
            );

            await getUserPermissions({ user, scmUri, level: 'push', isAdmin: adminDetails.isAdmin });

            Object.keys(request.payload).forEach(key => {
                job[key] = request.payload[key];
            });

            // Set stateChanger, stateChangeTime
            job.stateChanger = username;
            job.stateChangeTime = new Date().toISOString();

            return job
                .update()
                .then(updatedJob => h.response(updatedJob.toJson()).code(200))
                .catch(err => {
                    throw err;
                });
        },
        validate: {
            params: joi.object({
                id: idSchema
            }),
            payload: schema.models.job.update
        }
    }
});
