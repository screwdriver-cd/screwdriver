'use strict';

const boom = require('boom');
const createRoute = require('./create');
const createTagRoute = require('./createTag');
const getRoute = require('./get');
const listRoute = require('./list');
const removeRoute = require('./remove');
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
exports.register = (server, options, next) => {
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
     * @return {Promise}
     */
    server.expose('canRemove', (credentials, command, permission) => {
        const { username, scmContext, scope, isPR } = credentials;
        const { userFactory, pipelineFactory } = server.root.app;

        return pipelineFactory.get(command.pipelineId).then((pipeline) => {
            if (!pipeline) {
                throw boom.notFound(`Pipeline ${command.pipelineId} does not exist`);
            }

            if (scope.includes('user')) {
                return userFactory.get({ username, scmContext }).then((user) => {
                    if (!user) {
                        throw boom.notFound(`User ${username} does not exist`);
                    }

                    return user.getPermissions(pipeline.scmUri).then((permissions) => {
                        if (!permissions[permission]) {
                            throw boom.forbidden(`User ${username} does not have ` +
                                `${permission} access for this command`);
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
        listRoute(),
        listVersionsRoute(),
        listTagsRoute(),
        updateTrustedRoute()
    ]);

    next();
};

exports.register.attributes = {
    name: 'commands'
};
