'use strict';

const createRoute = require('./create');
const listRoute = require('./list');

/**
 * Template API Plugin
 * @method register
 * @param  {Hapi}     server            Hapi Server
 * @param  {Object}   options           Configuration
 * @param  {Function} next              Function to call when done
 */
exports.register = (server, options, next) => {
    server.route([
        createRoute(),
        listRoute()
    ]);

    next();
};

exports.register.attributes = {
    name: 'templates'
};
