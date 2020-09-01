'use strict';

const infoRoute = require('./info');
const tokenRoute = require('./token');

/**
 * Coverage API Plugin
 * @method register
 * @param  {Hapi}      server          Hapi Server
 * @param  {Object}    options         Configuration
 * @param  {Function}  next            Function to call when done
 */
const coverageAPIPlugin = {
    name: 'coverage',
    async register(server, options) {
        const { coveragePlugin } = options;

        server.route([infoRoute({ coveragePlugin }), tokenRoute({ coveragePlugin })]);
    }
};

module.exports = coverageAPIPlugin;
