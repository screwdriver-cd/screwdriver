'use strict';

// const getRoute = require('./get');
// const updateRoute = require('./update');
const createRoute = require('./create');

/**
 * Build Cluster API Plugin
 * @method register
 * @param  {Hapi}     server                Hapi Server
 * @param  {Object}   options               Configuration
 * @param  {Function} next                  Function to call when done
 */
exports.register = (server, options, next) => {
    server.route([
        // getRoute(),
        // updateRoute(),
        createRoute()
    ]);

    next();
};

exports.register.attributes = {
    name: 'buildClusters'
};
