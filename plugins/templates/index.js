'use strict';

const createRoute = require('./create');
const createTagRoute = require('./createTag');
const getRoute = require('./get');
const listRoute = require('./list');
const listTagsRoute = require('./listTags');
const listVersionsRoute = require('./listVersions');
const removeRoute = require('./remove');
const removeTagRoute = require('./removeTag');

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
        createTagRoute(),
        getRoute(),
        listRoute(),
        listTagsRoute(),
        listVersionsRoute(),
        removeRoute(),
        removeTagRoute()
    ]);

    next();
};

exports.register.attributes = {
    name: 'templates'
};
