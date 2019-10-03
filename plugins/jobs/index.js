'use strict';

const getRoute = require('./get');
const updateRoute = require('./update');
const listBuildsRoute = require('./listBuilds');
const lastSuccessfulMeta = require('./lastSuccessfulMeta');
const latestBuild = require('./latestBuild');
const metrics = require('./metrics');

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
        lastSuccessfulMeta(),
        metrics(),
        latestBuild()
    ]);

    next();
};

exports.register.attributes = {
    name: 'jobs'
};
