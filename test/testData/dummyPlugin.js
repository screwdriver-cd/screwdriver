'use strict';

module.exports.register = (server, options, next) => {
    server.route({
        method: 'GET',
        path: '/dummy',
        handler: (request, reply) => {
            reply('dummy');
        }
    });

    next();
};

module.exports.register.attributes = {
    name: 'dummyPlugin',
    version: '1.0.0'
};
