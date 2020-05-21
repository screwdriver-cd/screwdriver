'use strict';

const deleteRoute = require('./delete');

exports.register = (server, options, next) => {
    server.route([deleteRoute()]);

    next();
};

exports.register.attributes = {
    name: 'caches'
};
