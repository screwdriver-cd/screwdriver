'use strict';

const boom = require('@hapi/boom');
const createRoute = require('./create');
const getRoute = require('./get');
const removeRoute = require('./remove');
const updateRoute = require('./update');
const { getUserPermissions, getScmUri } = require('../helper');

/**
 * Secrets API Plugin
 * @method register
 * @param  {Hapi}     server            Hapi Server
 */
const secretsPlugin = {
    name: 'secrets',
    async register(server) {
        /**
         * Throws error if a credential does not have access to a secret
         * If credential has access, returns whether secret value will be shown
         * @method canAccess
         * @param {Object}  credentials              Credential object from Hapi
         * @param {String}  credentials.username     Username of the person logged in (or build ID)
         * @param {String}  credentials.scmContext   Scm of the person logged in (or build ID)
         * @param {Array}   credentials.scope        Scope of the credential (user, build, admin)
         * @param {String}  [credentials.pipelineId] If credential is a build, this is the pipeline ID
         * @param {String}  [credentials.configPipelineId] If credential is a build, this is the parent pipeline ID
         * @param {String}  [credentials.jobId]      If credential is a build, this is the job ID
         * @param {String}  [credentials.isPR]       If credential is a build, this is true if a PR
         * @param {Object}  secret                   Secret object from Hapi
         * @param {String}  permission               Required permission level
         * @param {String}  app                      Server app object
         * @return {Boolean}
         */
        server.expose('canAccess', async (credentials, secret, permission, app) => {
            const { userFactory, pipelineFactory } = app;
            const { scmContext, scope, username } = credentials;

            // Get secret pipeline
            const pipeline = await pipelineFactory.get(secret.pipelineId);

            if (!pipeline) {
                throw boom.notFound(`Pipeline ${secret.pipelineId} does not exist`);
            }

            // Use parent's scmUri if pipeline is child pipeline and using read-only SCM
            const scmUri = await getScmUri({ pipeline, pipelineFactory });

            // Check pipeline scope
            if (scope.includes('pipeline')) {
                if (parseInt(secret.pipelineId, 10) !== parseInt(credentials.pipelineId, 10)) {
                    throw boom.forbidden('Token does not have permission to this secret');
                }
            }

            // Check user scope
            if (scope.includes('user')) {
                const user = await userFactory.get({ username, scmContext });

                if (!user) {
                    throw boom.notFound(`User ${username} does not exist`);
                }

                await getUserPermissions({ user, scmUri, level: permission });

                return false;
            }

            // Check if secret belongs to current pipeline or parent pipeline
            if (secret.pipelineId !== credentials.pipelineId && secret.pipelineId !== credentials.configPipelineId) {
                throw boom.forbidden(`${username} is not allowed to access this secret`);
            }

            // Check for pull request
            if (!secret.allowInPR && credentials.isPR) {
                throw boom.forbidden('This secret is not allowed in pull requests');
            }

            return true;
        });

        server.route([createRoute(), getRoute(), removeRoute(), updateRoute()]);
    }
};

module.exports = secretsPlugin;
