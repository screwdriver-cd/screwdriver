'use strict';

const urlLib = require('url');
const boom = require('@hapi/boom');
const schema = require('screwdriver-data-schema');
const logger = require('screwdriver-logger');
const { formatCheckoutUrl, sanitizeRootDir } = require('./helper');
const { getUserPermissions } = require('../helper');
const ANNOTATION_USE_DEPLOY_KEY = 'screwdriver.cd/useDeployKey';

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

        handler: async (request, h) => {
            const checkoutUrl = formatCheckoutUrl(request.payload.checkoutUrl);
            const rootDir = sanitizeRootDir(request.payload.rootDir);
            const { autoKeysGeneration } = request.payload;
            const { pipelineFactory, userFactory, collectionFactory, secretFactory } = request.server.app;
            const { username, scmContext } = request.auth.credentials;
            const deployKeySecret = 'SD_SCM_DEPLOY_KEY';

            // fetch the user
            const user = await userFactory.get({ username, scmContext });
            const token = await user.unsealToken();

            let scmUri;

            try {
                scmUri = await pipelineFactory.scm.parseUrl({
                    scmContext,
                    rootDir,
                    checkoutUrl,
                    token
                });
            } catch (error) {
                logger.error(error.message);
                throw boom.boomify(error, { statusCode: error.statusCode });
            }

            // get the user permissions for the repo
            await getUserPermissions({ user, scmUri });

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
                adminUserIds: [user.id],
                scmContext,
                scmUri
            };

            logger.info(`[Audit] user ${user.username}:${scmContext} creates the pipeline for ${scmUri}.`);
            pipeline = await pipelineFactory.create(pipelineConfig);

            const collections = await collectionFactory.list({
                params: {
                    userId: user.id,
                    type: 'default'
                }
            });
            let defaultCollection;

            if (collections && collections.length > 0) {
                [defaultCollection] = collections;
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

            const results = await pipeline.sync();

            // check if pipeline has deploy key annotation then create secrets
            const deployKeyAnnotation = pipeline.annotations && pipeline.annotations[ANNOTATION_USE_DEPLOY_KEY];

            if (autoKeysGeneration || deployKeyAnnotation) {
                const privateDeployKey = await pipelineFactory.scm.addDeployKey({
                    scmContext,
                    checkoutUrl,
                    token
                });
                const privateDeployKeyB64 = Buffer.from(privateDeployKey).toString('base64');

                await secretFactory.create({
                    pipelineId: pipeline.id,
                    name: deployKeySecret,
                    value: privateDeployKeyB64,
                    allowInPR: true
                });
            }

            await pipeline.addWebhooks(`${request.server.info.uri}/v4/webhooks`);

            const location = urlLib.format({
                host: request.headers.host,
                port: request.headers.port,
                protocol: request.server.info.protocol,
                pathname: `${request.path}/${pipeline.id}`
            });
            const data = await results.toJson();

            return h.response(data).header('Location', location).code(201);
        },
        validate: {
            payload: schema.models.pipeline.create
        }
    }
});
