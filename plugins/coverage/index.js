'use strict';

const infoRoute = require('./info');
const tokenRoute = require('./token');

/**
 * Coverage API Plugin
 * @method register
 * @param  {Hapi}      server          Hapi Server
 * @param  {Object}    options         Configuration
 * @param  {Function}  next            Function to call when done
 */
exports.register = (server, options, next) => {
    const { coveragePlugin } = options;

    server.route([
        infoRoute({ coveragePlugin }),
        tokenRoute({ coveragePlugin })
    ]);

    next();
};

exports.register.attributes = {
    name: 'coverage'
};
