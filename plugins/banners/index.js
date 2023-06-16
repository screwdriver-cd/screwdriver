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
        server.expose('screwdriverAdminDetails', (username, scmDisplayName, scmUserId) => {
            // construct object with defaults to store details
            const adminDetails = {
                isAdmin: false
            };

            if (scmDisplayName) {
                const userDisplayName = options.authCheckById
                    ? `${scmDisplayName}:${username}:${scmUserId}`
                    : `${scmDisplayName}:${username}`;
                const admins = options.authCheckById ? options.sdAdmins : options.admins;

                // Check admin
                if (admins.length > 0 && admins.includes(userDisplayName)) {
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
