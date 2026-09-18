'use strict';

const fs = require('fs');
const rewiremock = require('rewiremock/node');
const sinon = require('sinon');
const hapi = require('@hapi/hapi');

const jwtPrivateKey = fs.readFileSync(`${__dirname}/data/jwt.private.key`).toString();
const jwtPublicKey = fs.readFileSync(`${__dirname}/data/jwt.public.key`).toString();

const newAuthTestServer = async () => {
    const authDeps = ['@hapi/cookie', '@hapi/bell', 'hapi-auth-jwt2', 'hapi-auth-bearer-token'];
    const cookiePassword = 'this_is_a_password_that_needs_to_be_atleast_32_characters';
    const encryptionPassword = 'this_is_another_password_that_needs_to_be_atleast_32_characters';
    const hashingPassword = 'this_is_another_password_that_needs_to_be_atleast_32_characters';
    const oauthRedirectUri = 'https://example.com/api';
    const scm = {
        getReadOnlyInfo: sinon.stub().returns({ enabled: false, username: 'headlessuser', accessToken: 'token' }),
        getScmContexts: sinon.stub().returns(['github:github.com']),
        getDisplayName: sinon.stub().returns('github'),
        getBellConfiguration: sinon.stub().resolves({
            'github:github.com': {
                clientId: 'abcdefg',
                clientSecret: 'hijklmno',
                provider: 'github',
                scope: ['admin:repo_hook', 'read:org', 'repo:status']
            }
        }),
        scms: {
            'github:github.com': {
                clientId: 'abcdefg',
                clientSecret: 'hijklmno',
                provider: 'github',
                scope: ['admin:repo_hook', 'read:org', 'repo:status']
            }
        },
        autoDeployKeyGenerationEnabled: sinon.stub().returns(true),
        decorateAuthor: sinon.stub(),
        isEnterpriseUser: sinon.stub().resolves(false)
    };
    const baseProfile = {
        username: 'batman',
        scmUserId: 123,
        scmContext: 'github:github.com',
        scope: ['user'],
        metadata: {}
    };
    const tokenFactoryMock = {
        get: sinon.stub().returns({})
    };
    const loggerMock = {
        info: sinon.stub(),
        error: sinon.stub(),
        warn: sinon.stub()
    };
    const server = new hapi.Server({
        port: 1234,
        routes: {
            // ignore request and response validation
            validate: { failAction: 'ignore' },
            response: { failAction: 'ignore' }
        }
    });

    server.app = {
        tokenFactory: tokenFactoryMock
    };
    // ignore handler for each routes
    server.ext('onPreHandler', (request, h) => {
        return h
            .response({
                testAuth: request.auth,
                testReachedAfterAuth: true
            })
            .code(200)
            .takeover();
    });

    for (const pluginName of authDeps) {
        // eslint-disable-next-line global-require, import/no-dynamic-require
        await server.register({ plugin: require(pluginName) });
    }

    const authPlugin = rewiremock.proxy('../../plugins/auth', {
        'screwdriver-logger': loggerMock
    });

    await server.register({
        plugin: authPlugin,
        options: {
            cookiePassword,
            encryptionPassword,
            hashingPassword,
            scm,
            jwtPrivateKey,
            jwtPublicKey,
            jwtQueueServicePublicKey: jwtPublicKey,
            allowGuestAccess: true,
            https: false,
            oauthRedirectUri,
            sameSite: false,
            bell: scm.scms,
            path: '/',
            admins: ['github:batman', 'batman'],
            sdAdmins: ['github:batman:1312'],
            authCheckById: true
        }
    });

    server.generateTestJwt = ({ type = 'api_token', permission = 'all' }) => {
        const profile = server.plugins.auth.generateProfile({
            ...baseProfile,
            auth: {
                type,
                apiTokenId: 123
            },
            options: { permission }
        });

        return server.plugins.auth.generateToken(profile);
    };

    return server;
};

const serverInject = async (server, route, jwt) => {
    const option = { ...route };

    if (jwt) {
        option.headers = { authorization: `Bearer ${jwt}` };
    }

    return server.inject(option);
};

module.exports = {
    newAuthTestServer,
    serverInject
};
