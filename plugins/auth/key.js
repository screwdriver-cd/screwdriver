'use strict';

const schema = require('screwdriver-data-schema');

/**
 * Display the public key for verifying the JWT
 * @method key
 * @param  {Object} options
 * @param  {String} options.jwtPublicKey  Public Key for verifying a JWT was signed by us
 * @return {Object}                       Hapi Plugin Route
 */
module.exports = options => ({
    method: ['GET'],
    path: '/auth/key',
    options: {
        description: 'Get jwt public key',
        notes: 'Public Key for verifying JSON Web Tokens',
        tags: ['api', 'auth', 'key'],
        plugins: {
            'hapi-rate-limit': {
                enabled: false
            }
        },
        handler: async (request, h) =>
            h.response({
                key: options.jwtPublicKey
            }),
        response: {
            schema: schema.api.auth.key
        }
    }
});
