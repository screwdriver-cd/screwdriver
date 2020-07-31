'use strict';

const boom = require('@hapi/boom');
const createRoute = require('./create');
const getRoute = require('./get');
const removeRoute = require('./remove');
const updateRoute = require('./update');

/**
 * Secrets API Plugin
 * @method register
 * @param  {Hapi}     server            Hapi Server
 * @param  {Object}   options           Configuration
 * @param  {Function} next              Function to call when done
 */
exports.register = (server, options, next) => {
    /**
     * Throws error if a credential does not have access to a secret
     * If credential has access, returns whether secret value will be shown
     * @method canAccess
     * @param {Object}  credentials              Credential object from Hapi
     * @param {String}  credentials.username     Username of the person logged in (or build ID)
     * @param {String}  credentials.scmContext   Scm of the person logged in (or build ID)
     * @param {Array}   credentials.scope        Scope of the credential (user, build, admin)
     * @param {String}  [credentials.pipelineId] If credential is a build, this is the pipeline ID
     * @param {String}  [credentials.jobId]      If credential is a build, this is the job ID
     * @param {String}  [credentials.isPR]       If credential is a build, this is true if a PR
     * @param {Object}  secret                   Secret object from Hapi
     * @param {String}  permission               Required permission level
     * @return {Boolean}
     */
    server.expose('canAccess', (credentials, secret, permission) => {
        const { userFactory } = server.root.app;
        const { pipelineFactory } = server.root.app;
        const { username } = credentials;
        const { scmContext } = credentials;
        const { scope } = credentials;

        return pipelineFactory.get(secret.pipelineId).then(pipeline => {
            if (!pipeline) {
                throw boom.notFound(`Pipeline ${secret.pipelineId} does not exist`);
            }

            if (scope.includes('user')) {
                return userFactory.get({ username, scmContext }).then(user => {
                    if (!user) {
                        throw boom.notFound(`User ${username} does not exist`);
                    }

                    return user.getPermissions(pipeline.scmUri).then(permissions => {
                        if (!permissions[permission]) {
                            throw boom.forbidden(`User ${username}
                                does not have ${permission} access to this repo`);
                        }

                        return false;
                    });
                });
            }

            if (scope.includes('pipeline') && secret.pipelineId !== credentials.pipelineId) {
                throw boom.forbidden('Token does not have permission to this secret');
            }

            if (secret.pipelineId !== credentials.pipelineId && secret.pipelineId !== credentials.configPipelineId) {
                throw boom.forbidden(`${username} is not allowed to access this secret`);
            }

            if (!secret.allowInPR && credentials.isPR) {
                throw boom.forbidden('This secret is not allowed in pull requests');
            }

            return true;
        });
    });

    server.route([createRoute(), getRoute(), removeRoute(), updateRoute()]);

    next();
};

exports.register.attributes = {
    name: 'secrets'
};
