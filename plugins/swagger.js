'use strict';

const swagger = require('hapi-swagger');

module.exports = {
    register: swagger,
    options: {
        info: {
            title: 'Screwdriver API Documentation',
            version: '3'
        },
        securityDefinitions: {
            token: {
                type: 'bearer',
                name: 'X-Token',
                in: 'header'
            }
        }
    },
    security: [{ token: [] }]
};
