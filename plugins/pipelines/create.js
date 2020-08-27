'use strict';

const boom = require('@hapi/boom');
const schema = require('screwdriver-data-schema');
const urlLib = require('url');
const helper = require('./helper');

module.exports = () => ({
    method: 'POST',
    path: '/pipelines',
    options: {
        description: 'Create a new pipeline',
        notes: 'Create a specific pipeline',
        tags: ['api', 'pipelines'],
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
            const checkoutUrl = helper.formatCheckoutUrl(request.payload.checkoutUrl);
            const rootDir = helper.sanitizeRootDir(request.payload.rootDir);
            const { autoKeysGeneration } = request.payload;
            const { pipelineFactory, userFactory, collectionFactory, secretFactory } = request.server.app;
            const { username, scmContext } = request.auth.credentials;
            const pipelineToken = '';
            const deployKeySecret = 'SD_SCM_DEPLOY_KEY';

            // fetch the user
            const user = await userFactory.get({ username, scmContext });
            const token = await user.unsealToken();
            const scmUri = await pipelineFactory.scm.parseUrl({
                scmContext,
                rootDir,
                checkoutUrl,
                token
            });
            // get the user permissions for the repo

            const permissions = await user.getPermissions(scmUri);
            // if the user isn't an admin, reject

            if (!permissions.admin) {
                throw boom.forbidden(`User ${user.getFullDisplayName()} is not an admin of this repo`);
            }
            // see if there is already a pipeline
            let pipeline = await pipelineFactory.get({ scmUri });
            // if there is already a pipeline for the checkoutUrl, reject

            if (pipeline) {
                throw boom.conflict(`Pipeline already exists with the ID: ${pipeline.id}`, {
                    existingId: pipeline.id
                });
            }
            // set up pipeline admins, and create a new pipeline
            const pipelineConfig = {
                admins: {
                    [username]: true
                },
                scmContext,
                scmUri
            };

            pipeline = await pipelineFactory.create(pipelineConfig);

            const collections = await collectionFactory.list({
                params: {
                    userId: user.id,
                    type: 'default'
                }
            });
            let defaultCollection;

            if (collections && collections.length > 0) {
                defaultCollection = collections[0];
            }

            if (!defaultCollection) {
                defaultCollection = await collectionFactory.create({
                    userId: user.id,
                    name: 'My Pipelines',
                    description: `The default collection for ${user.username}`,
                    type: 'default'
                });
            }

            // Check if the pipeline exists in the default collection
            // to prevent the situation where a pipeline is deleted and then created right away with the same id
            if (!defaultCollection.pipelineIds.includes(pipeline.id)) {
                Object.assign(defaultCollection, {
                    pipelineIds: [...defaultCollection.pipelineIds, pipeline.id]
                });

                await defaultCollection.update();
            }
            if (autoKeysGeneration) {
                const privateDeployKey = await pipelineFactory.scm.addDeployKey({
                    scmContext,
                    checkoutUrl,
                    token: pipelineToken
                });
                const privateDeployKeyB64 = Buffer.from(privateDeployKey).toString('base64');

                await secretFactory.create({
                    pipelineId: pipeline.id,
                    name: deployKeySecret,
                    value: privateDeployKeyB64,
                    allowInPR: true
                });
            }

            const results = await Promise.all([
                pipeline.sync(),
                pipeline.addWebhook(`${request.server.info.uri}/v4/webhooks`)
            ]);

            const location = urlLib.format({
                host: request.headers.host,
                port: request.headers.port,
                protocol: request.server.info.protocol,
                pathname: `${request.path}/${pipeline.id}`
            });
            const data = await results[0].toJson();

            return h
                .response(data)
                .header('Location', location)
                .code(201);
        },
        validate: {
            payload: schema.models.pipeline.create
        }
    }
});
