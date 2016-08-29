'use strict';
const crumb = require('crumb');

/**
 * Hapi interface for plugin to set up crumb generator end point
 * @method register
 * @param  {Hapi.Server}    server
 * @param  {Object}         options
 * @param  {Function} next
 */
exports.register = (server, options, next) => {
    server.register({
        register: crumb,
        options: {
            restful: true,
            skip: (request) =>
                // Skip crumb validation when the request is authorized with jwt or the route is under webhooks
                !!request.headers.authorization || !!request.route.path.includes('/webhooks/')
        }
    }, (err) => {
        /* istanbul ignore if */
        if (err) { // Completely untestable
            throw err;
        }

        server.route({
            method: 'GET',
            path: '/crumb',
            config: {
                description: 'crumb generator',
                notes: 'Should return a crumb',
                tags: ['api', 'crumb'],
                handler: (request, reply) => reply({
                    crumb: server.plugins.crumb.generate(request, reply)
                })
            }
        });
        next();
    });
};

exports.register.attributes = {
    name: 'crumb generator'
};
