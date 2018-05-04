'use strict';

const createRoute = require('./create');
const listRoute = require('./list');
const getRoute = require('./get');
const updateRoute = require('./update');
const removeRoute = require('./remove');
// const boom = require('boom');

/**
 * Banner API Plugin
 * @method register
 * @param  {Hapi}     server            Hapi Server
 * @param  {Object}   options           Configuration
 * @param  {Function} next              Function to call when done
 */
exports.register = (server, options, next) => {
    server.route([
        createRoute(),
        listRoute(),
        getRoute(),
        updateRoute(),
        removeRoute()
    ]);

    next();
};

exports.register.attributes = {
    name: 'banners'
};

