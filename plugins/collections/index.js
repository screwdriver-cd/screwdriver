'use strict';

const createRoute = require('./create');
const getRoute = require('./get');
const listRoute = require('./list');
const updateRoute = require('./update');
const removeRoute = require('./remove');
const removePipelinesRoute = require('./removePipelines');
const addPipelineRoute = require('./addPipeline');

/**
 * Collections API Plugin
 * @method register
 * @param  {Hapi}      server          Hapi Server
 * @param  {Object}    options         Configuration
 * @param  {Function}  next            Function to call when done
 */
const collectionsPlugin = {
    name: 'collections',
    async register(server) {
        server.route([
            createRoute(),
            getRoute(),
            listRoute(),
            updateRoute(),
            removeRoute(),
            removePipelinesRoute(),
            addPipelineRoute()
        ]);
    }
};

module.exports = collectionsPlugin;
