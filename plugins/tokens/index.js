'use strict';

const boom = require('boom');
const createRoute = require('./create');
const listRoute = require('./list');
const updateRoute = require('./update');
const refreshRoute = require('./refresh');
const removeRoute = require('./remove');

/**
 * Tokens API Plugin
 * @method register
 * @param  {Hapi}     server            Hapi Server
 * @param  {Object}   options           Configuration
 * @param  {Function} next              Function to call when done
 */
exports.register = (server, options, next) => {
    /**
     * Throws error if a credential does not have access to a token
     * If credential has access, returns true
     * @method canAccess
     * @param {Object}  credentials              Credential object from Hapi
     * @param {String}  credentials.username     Username of the person logged in
     * @param {String}  credentials.scmContext   Scm of the person logged in
     * @param {Object}  token                    Token object
     * @return {Boolean}
     */
    server.expose('canAccess', (credentials, token) => {
        const userFactory = server.root.app.userFactory;
        const username = credentials.username;
        const scmContext = credentials.scmContext;

        return userFactory.get({ username, scmContext }).then((user) => {
            if (!user) {
                throw boom.notFound(`User ${username} does not exist`);
            }

            if (user.id !== token.userId) {
                throw boom.forbidden('User does not own token');
            }

            return true;
        });
    });

    server.route([
        createRoute(),
        listRoute(),
        updateRoute(),
        refreshRoute(),
        removeRoute()
    ]);

    next();
};

exports.register.attributes = {
    name: 'tokens'
};
