'use strict';

const createRoute = require('./create');
const createTagRoute = require('./createTag');
const getRoute = require('./get');
const listRoute = require('./list');
const listVersionsRoute = require('./listVersions');

/**
 * Command API Plugin
 * @method register
 * @param  {Hapi}     server            Hapi Server
 * @param  {Object}   options           Configuration
 * @param  {Function} next              Function to call when done
 */
exports.register = (server, options, next) => {
    server.route([
        createRoute(),
        createTagRoute(),
        getRoute(),
        listRoute(),
        listVersionsRoute()
    ]);

    next();
};

exports.register.attributes = {
    name: 'commands'
};
