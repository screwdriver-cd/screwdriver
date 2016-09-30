'use strict';

const getRoute = require('./get');
const updateRoute = require('./update');
const listBuildsRoute = require('./listBuilds');

/**
 * Job API Plugin
 * @method register
 * @param  {Hapi}     server            Hapi Server
 * @param  {Object}   options           Configuration
 * @param  {Function} next              Function to call when done
 */
exports.register = (server, options, next) => {
    server.route([
        getRoute(),
        updateRoute(),
        listBuildsRoute()
    ]);

    next();
};

exports.register.attributes = {
    name: 'jobs'
};
