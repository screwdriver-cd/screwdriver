'use strict';

const getRoute = require('./get');
const updateRoute = require('./update');
const listBuildsRoute = require('./listBuilds');
const lastSuccessfulMeta = require('./lastSuccessfulMeta');
const latestBuild = require('./latestBuild');
const metrics = require('./metrics');
const notify = require('./notify');

/**
 * Job API Plugin
 * @method register
 * @param  {Hapi}     server            Hapi Server
 */
const jobsPlugin = {
    name: 'jobs',
    async register(server) {
        server.route([
            getRoute(),
            updateRoute(),
            listBuildsRoute(),
            lastSuccessfulMeta(),
            metrics(),
            latestBuild(),
            notify()
        ]);
    }
};

module.exports = jobsPlugin;
