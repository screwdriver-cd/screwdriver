'use strict';

const getRoute = require('./get');
const listRoute = require('./list');
const createRoute = require('./create');
const removeRoute = require('./remove');

/**
 * Build Cluster API Plugin
 * @method register
 * @param  {Hapi}     server                Hapi Server
 * @param  {Object}   options               Configuration
 * @param  {Function} next                  Function to call when done
 */
exports.register = (server, options, next) => {
    server.route([
        getRoute(),
        listRoute(),
        createRoute(),
        removeRoute()
    ]);

    next();
};

exports.register.attributes = {
    name: 'buildClusters'
};
