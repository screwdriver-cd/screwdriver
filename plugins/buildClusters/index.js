'use strict';

const createRoute = require('./create');
const getRoute = require('./get');
const listRoute = require('./list');
const removeRoute = require('./remove');
const updateRoute = require('./update');

/**
 * Build Cluster API Plugin
 * @method register
 * @param  {Hapi}     server                Hapi Server
 * @param  {Object}   options               Configuration
 * @param  {Function} next                  Function to call when done
 */
const buildClustersPlugin = {
    name: 'buildClusters',
    async register(server, options) {
        server.route([createRoute(), getRoute(), listRoute(), removeRoute(), updateRoute()]);
    }
};

module.exports = buildClustersPlugin
