'use strict';

const getStageBuildsRoute = require('./stageBuilds/list');
const getRoute = require('./get');

/**
 * Stage API Plugin
 * @method register
 * @param  {Hapi}     server                Hapi Server
 * @param  {Object}   options               Configuration
 * @param  {Function} next                  Function to call when done
 */
const stagesPlugin = {
    name: 'stages',
    async register(server) {
        server.route([getStageBuildsRoute(), getRoute()]);
    }
};

module.exports = stagesPlugin;
