'use strict';

const boom = require('boom');
const createRoute = require('./create');
const getRoute = require('./get');
const listBuildsRoute = require('./listBuilds');
const stopBuildsRoute = require('./stopBuilds');
const metricsRoute = require('./metrics');

/**
 * Event API Plugin
 * @method register
 * @param  {Hapi}     server            Hapi Server
 * @param  {Object}   options           Configuration
 * @param  {Function} next              Function to call when done
 */
exports.register = (server, options, next) => {
    /**
     * Update pipeline admin array
     * @method updateAdmins
     * @param  {Object}    permissions  User permissions
     * @param  {Pipeline}  pipeline     Pipeline object to update
     * @param  {String}    username     Username of user
     * @return {Promise}                Updates the pipeline admins and throws an error if not an admin
     */
    server.expose('updateAdmins', ({ permissions, pipeline, username }) => {
        const newAdmins = pipeline.admins;

        // Delete user from admin list if bad permissions
        if (!permissions.push) {
            delete newAdmins[username];
            // This is needed to make admins dirty and update db
            pipeline.admins = newAdmins;

            return pipeline.update()
                .then(() => {
                    throw boom.forbidden(`User ${username} `
                    + 'does not have push permission for this repo');
                });
        }

        // Add user as admin if permissions good and does not already exist
        if (!pipeline.admins[username]) {
            newAdmins[username] = true;
            // This is needed to make admins dirty and update db
            pipeline.admins = newAdmins;

            return pipeline.update();
        }

        return Promise.resolve();
    });

    server.route([
        createRoute(),
        getRoute(),
        listBuildsRoute(),
        stopBuildsRoute(),
        metricsRoute()
    ]);

    next();
};

exports.register.attributes = {
    name: 'events'
};
