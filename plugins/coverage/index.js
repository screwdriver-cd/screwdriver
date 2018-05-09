'use strict';

const linksRoute = require('./links');
const tokenRoute = require('./token');

/**
 * Coverage API Plugin
 * @method register
 * @param  {Hapi}      server          Hapi Server
 * @param  {Object}    options         Configuration
 * @param  {Function}  next            Function to call when done
 */
exports.register = (server, options, next) => {
    const coveragePlugin = options.coveragePlugin;

    server.route([
        linksRoute({ coveragePlugin }),
        tokenRoute({ coveragePlugin })
    ]);

    next();
};

exports.register.attributes = {
    name: 'coverage'
};
