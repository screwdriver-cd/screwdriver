'use strict';

const jwt = require('jsonwebtoken');

module.exports = {
    /**
     * Generates a profile for storage in cookie and jwt
     * @method generateProfile
     * @param  {String}        username Username of the person
     * @param  {Array|String}  scope    Scope for this profile (usually build or user)
     * @return {Object}                 The profile to be stored in jwt and/or cookie
     */
    generateProfile: (username, scope) => ({
        username, scope
    }),

    /**
     * Generates a jwt that is signed and has a 12h lifespan
     * @method generateToken
     * @param  {Object} profile Object from generateProfile
     * @param  {String} key     Signing key for jwt
     * @return {String}         Signed jwt that includes that profile
     */
    generateToken: (profile, key) => jwt.sign(profile, key, {
        algorithm: 'HS256',
        expiresIn: '12h'
    })
};
