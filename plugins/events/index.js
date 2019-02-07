'use strict';

const createRoute = require('./create');
const getRoute = require('./get');
const listBuildsRoute = require('./listBuilds');
const metricsRoute = require('./metrics');

/**
 * Event API Plugin
 * @method register
 * @param  {Hapi}     server            Hapi Server
 * @param  {Object}   options           Configuration
 * @param  {Function} next              Function to call when done
 */
exports.register = (server, options, next) => {
    server.route([
        createRoute(),
        getRoute(),
        listBuildsRoute(),
        metricsRoute()
    ]);

    next();
};

exports.register.attributes = {
    name: 'events'
};
