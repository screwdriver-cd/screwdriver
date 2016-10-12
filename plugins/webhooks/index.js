'use strict';

const githubRoute = require('./github');

/**
 * Webhook API Plugin
 * @method register
 * @param  {Hapi}     server            Hapi Server
 * @param  {Object}   options           Configuration
 * @param  {String}   options.secret    GitHub Webhook secret to sign payloads with
 * @param  {Function} next              Function to call when done
 */
exports.register = (server, options, next) => {
    server.route([
        githubRoute(server, options)
    ]);

    next();
};

exports.register.attributes = {
    name: 'webhooks'
};
