'use strict';
const githubRoute = require('./github');
const buildRoute = require('./build');

/**
 * Webhook API Plugin
 * @method register
 * @param  {Hapi}     server            Hapi Server
 * @param  {Object}   options           Configuration
 * @param  {String}   options.secret    GitHub Webhook secret to sign payloads with
 * @param  {String}   options.password  Login password
 * @param  {Function} next              Function to call when done
 */
exports.register = (server, options, next) => {
    server.route([
        githubRoute(server, options),
        buildRoute(server, options)
    ]);

    next();
};

exports.register.attributes = {
    name: 'webhooks'
};
