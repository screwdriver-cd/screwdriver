'use strict';

const createRoute = require('./create');

/**
 * Template API Plugin
 * @method register
 * @param  {Hapi}     server            Hapi Server
 */
const pipelineTemplatesPlugin = {
    name: 'pipelineTemplates',
    async register(server) {
        server.route([createRoute()]);
    }
};

module.exports = pipelineTemplatesPlugin;
