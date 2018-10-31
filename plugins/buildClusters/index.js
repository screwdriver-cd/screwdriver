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
exports.register = (server, options, next) => {
    server.route([
        createRoute(),
        getRoute(),
        listRoute(),
        removeRoute(),
        updateRoute()
    ]);

    next();
};

exports.register.attributes = {
    name: 'buildClusters'
};
