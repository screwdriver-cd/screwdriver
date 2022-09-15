'use strict';

const getSettingsRoute = require('./settings/get');
const updateSettingsRoute = require('./settings/update');
const removeSettingsRoute = require('./settings/delete');

/**
 * Users API Plugin
 * @method register
 * @param  {Hapi}     server            Hapi Server
 */
const usersPlugin = {
    name: 'users',
    async register(server) {
        server.route([getSettingsRoute(), updateSettingsRoute(), removeSettingsRoute()]);
    }
};

module.exports = usersPlugin;
