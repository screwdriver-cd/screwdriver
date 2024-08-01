'use strict';

const boom = require('@hapi/boom');
const createRoute = require('./create');
const createTagRoute = require('./createTag');
const getRoute = require('./get');
const listRoute = require('./list');
const removeRoute = require('./remove');
const removeTagRoute = require('./removeTag');
const removeVersionRoute = require('./removeVersion');
const listTagsRoute = require('./listTags');
const listVersionsRoute = require('./listVersions');
const updateTrustedRoute = require('./updateTrusted');

/**
 * Command API Plugin
 * @method register
 * @param  {Hapi}     server            Hapi Server
 * @param  {Object}   options           Configuration
 * @param  {Function} next              Function to call when done
 */
const commandsPlugin = {
    name: 'commands',
    async register(server) {
        /**
         * Throws error if a credential does not have permission to remove command
         * If credential has access, resolves to true
         * @method canRemove
         * @param {Object}  credentials              Credential object from Hapi
         * @param {String}  credentials.username     Username of the person logged in (or build ID)
         * @param {String}  credentials.scmContext   Scm of the person logged in (or build ID)
         * @param {Array}   credentials.scope        Scope of the credential (user, build, admin)
         * @param {String}  [credentials.pipelineId] If credential is a build, this is the pipeline ID
         * @param {Object}  command                  Target command object
         * @param {String}  permission               Required permission level
         * @param {String}  app                      Server app object
         * @return {Promise}
         */
        server.expose('canRemove', (credentials, command, permission, app) => {
            const { username, scmContext, scope, isPR } = credentials;
            const { userFactory, pipelineFactory } = app;

            if (credentials.scope.includes('admin')) {
                return Promise.resolve(true);
            }

            return pipelineFactory.get(command.pipelineId).then(pipeline => {
                if (!pipeline) {
                    throw boom.notFound(`Pipeline ${command.pipelineId} does not exist`);
                }

                if (scope.includes('user')) {
                    return userFactory.get({ username, scmContext }).then(user => {
                        if (!user) {
                            throw boom.notFound(`User ${username} does not exist`);
                        }

                        return user.getPermissions(pipeline.scmUri).then(permissions => {
                            if (!permissions[permission]) {
                                throw boom.forbidden(
                                    `User ${username} does not have ${permission} access for this command`
                                );
                            }

                            return true;
                        });
                    });
                }

                if (command.pipelineId !== credentials.pipelineId || isPR) {
                    throw boom.forbidden('Not allowed to remove this command');
                }

                return true;
            });
        });

        server.route([
            createRoute(),
            createTagRoute(),
            getRoute(),
            removeRoute(),
            removeTagRoute(),
            removeVersionRoute(),
            listRoute(),
            listVersionsRoute(),
            listTagsRoute(),
            updateTrustedRoute()
        ]);
    }
};

module.exports = commandsPlugin;
