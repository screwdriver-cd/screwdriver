'use strict';

const assert = require('chai').assert;
const sinon = require('sinon');
const hapi = require('hapi');
const mockery = require('mockery');

sinon.assert.expose(assert, { prefix: '' });

describe('coverage plugin test', () => {
    let plugin;
    let server;
    let mockCoveragePlugin;
    const links = {
        badge: 'https://sonar.sd.cd/api/badges/measure?key=job%3A123&metric=coverage',
        project: 'https://sonar.sd.cd/dashboard?id=job%3A123'
    };

    before(() => {
        mockery.enable({
            useCleanCache: true,
            warnOnUnregistered: false
        });
    });

    beforeEach((done) => {
        mockCoveragePlugin = {
            getAccessToken: sinon.stub().resolves('faketoken'),
            getLinks: sinon.stub().resolves(links)
        };

        /* eslint-disable global-require */
        plugin = require('../../plugins/coverage');
        /* eslint-enable global-require */

        server = new hapi.Server();
        server.connection({
            port: 1234
        });

        server.auth.scheme('custom', () => ({
            authenticate: (request, reply) => reply.continue({
                credentials: {
                    scope: ['build']
                }
            })
        }));
        server.auth.strategy('token', 'custom');

        server.register([{
            register: plugin,
            options: {
                coveragePlugin: mockCoveragePlugin
            }
        }], (err) => {
            done(err);
        });
    });

    afterEach(() => {
        server = null;
        mockery.deregisterAll();
        mockery.resetCache();
    });

    after(() => {
        mockery.disable();
    });

    it('registers the plugin', () => {
        assert.isOk(server.registrations.coverage);
    });

    describe('GET /coverage/token', () => {
        it('returns 200', () => server.inject({
            url: '/coverage/token',
            credentials: {
                jobId: 123,
                scope: ['build']
            }
        }).then((reply) => {
            assert.equal(reply.statusCode, 200);
            assert.deepEqual(reply.result, 'faketoken');
        }));

        it('returns 500 if failed to get access token', () => {
            mockCoveragePlugin.getAccessToken.rejects(new Error('oops!'));

            return server.inject({
                url: '/coverage/token',
                credentials: {
                    jobId: 123,
                    scope: ['build']
                }
            }).then((reply) => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('GET /coverage/{id}/links', () => {
        it('returns 200', () => server.inject({
            url: '/coverage/123/links'
        }).then((reply) => {
            assert.equal(reply.statusCode, 200);
            assert.deepEqual(reply.result, links);
        }));

        it('returns 500 if failed to get links', () => {
            mockCoveragePlugin.getLinks.rejects(new Error('oops!'));

            return server.inject({
                url: '/coverage/123/links'
            }).then((reply) => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });
});
