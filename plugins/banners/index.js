'use strict';

const createRoute = require('./create');
const listRoute = require('./list');
const getRoute = require('./get');
const updateRoute = require('./update');
const removeRoute = require('./remove');

/**
 * Banner API Plugin
 * @method register
 * @param  {Hapi}     server            Hapi Server
 * @param  {Object}   options           Configuration
 * @param  {Function} next              Function to call when done
 */
const bannerPlugin = {
    name: 'banners',
    async register(server, options) {
        /**
         * Identifies userDisplayName and Screwdriver admin status of user
         * @method screwdriverAdminDetails
         * @param  {String}        username   Username of the person
         * @param  {String}        scmDisplayName Scm display name of the person
         * @return {Object}                   Details including the display name and admin status of user
         */
        server.expose('screwdriverAdminDetails', (username, scmDisplayName) => {
            // construct object with defaults to store details
            const adminDetails = {
                isAdmin: false
            };

            if (scmDisplayName) {
                const adminsList = options.admins;

                // construct displayable username string
                adminDetails.userDisplayName = `${scmDisplayName}:${username}`;

                // Check system configuration for list of system admins
                // set admin status true if current user is identified to be a system admin
                if (adminsList.length > 0 && adminsList.includes(adminDetails.userDisplayName)) {
                    adminDetails.isAdmin = true;
                }
            }

            // return details
            return adminDetails;
        });

        server.route([createRoute(), listRoute(), getRoute(), updateRoute(), removeRoute()]);
    }
};

module.exports = bannerPlugin;
