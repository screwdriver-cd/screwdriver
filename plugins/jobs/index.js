'use strict';

const getRoute = require('./get');
const updateRoute = require('./update');
const listBuildsRoute = require('./listBuilds');
const lastSuccessfulMeta = require('./lastSuccessfulMeta');

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
        listBuildsRoute(),
        lastSuccessfulMeta()
    ]);

    next();
};

exports.register.attributes = {
    name: 'jobs'
};
