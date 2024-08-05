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
                    jwt: {
                        type: 'apiKey',
                        name: 'Authorization',
                        in: 'header'
                    }
                },
                OAS: 'v3.0',
                // see https://github.com/glennjones/hapi-swagger/blob/master/optionsreference.md#json-json-endpoint-needed-to-create-ui
                documentationRoutePlugins: {
                    'hapi-rate-limit': {
                        enabled: false
                    }
                },
                security: [{ jwt: [] }]
            }
        });
    }
};

module.exports = swaggerPlugin;
