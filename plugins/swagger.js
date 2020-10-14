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
                },
                // see https://github.com/glennjones/hapi-swagger/blob/master/optionsreference.md#json-json-endpoint-needed-to-create-ui
                documentationRoutePlugins: {
                    'hapi-rate-limit': {
                        enabled: false
                    }
                }
            },
            security: [{ token: [] }]
        });
    }
};

module.exports = swaggerPlugin;
