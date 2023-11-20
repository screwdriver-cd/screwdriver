'use strict';

const getStageBuildsRoute = require('./stageBuilds/list');

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
        server.route([getStageBuildsRoute()]);
    }
};

module.exports = stagesPlugin;
