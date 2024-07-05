'use strict';

const boom = require('@hapi/boom');
const createRoute = require('./create');
const getRoute = require('./get');
const listBuildsRoute = require('./listBuilds');
const listStageBuildsRoute = require('./listStageBuilds');
const stopBuildsRoute = require('./stopBuilds');
const metricsRoute = require('./metrics');

/**
 * Event API Plugin
 * @method register
 * @param  {Hapi}     server            Hapi Server
 * @param  {Object}   options           Configuration
 * @param  {Function} next              Function to call when done
 */
const eventsPlugin = {
    name: 'events',
    async register(server) {
        /**
         * Update pipeline admin array
         * @method updateAdmins
         * @param  {Object}    permissions  User permissions
         * @param  {Pipeline}  pipeline     Pipeline object to update
         * @param  {String}    username     Username of user
         * @return {Promise}                Updates the pipeline admins and throws an error if not an admin
         */
        server.expose('updateAdmins', ({ permissions, pipeline, username }) => {
            // Delete user from admin list if bad permissions
            if (!permissions.push) {
                const newAdmins = pipeline.admins;

                delete newAdmins[username];
                // This is needed to make admins dirty and update db
                pipeline.admins = newAdmins;

                return pipeline.update().then(() => {
                    throw boom.forbidden(`User ${username} does not have push permission for this repo`);
                });
            }

            // Put current user at the head of admins to use its SCM token after this
            // SCM token is got from the first pipeline admin
            const newAdminNames = [username, ...Object.keys(pipeline.admins)];
            const newAdmins = {};

            newAdminNames.forEach(name => {
                newAdmins[name] = true;
            });

            pipeline.admins = newAdmins;

            return pipeline.update();
        });

        server.route([
            createRoute(),
            getRoute(),
            listBuildsRoute(),
            listStageBuildsRoute(),
            stopBuildsRoute(),
            metricsRoute()
        ]);
    }
};

module.exports = eventsPlugin;
