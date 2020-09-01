'use strict';

const swagger = require('hapi-swagger');

const swaggerPlugin = {
    name: 'swagger',
    async register(server) {
        server.register({
            plugin: swagger,
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
        });
    }
};

module.exports = swaggerPlugin;
