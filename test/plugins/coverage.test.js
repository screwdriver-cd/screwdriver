'use strict';

const { assert } = require('chai');
const sinon = require('sinon');
const hapi = require('@hapi/hapi');
const mockery = require('mockery');

sinon.assert.expose(assert, { prefix: '' });

describe('coverage plugin test', () => {
    let plugin;
    let server;
    let mockCoveragePlugin;

    before(() => {
        mockery.enable({
            useCleanCache: true,
            warnOnUnregistered: false
        });
    });

    beforeEach(done => {
        mockCoveragePlugin = {
            getAccessToken: sinon.stub().resolves('faketoken'),
            getInfo: sinon.stub()
        };

        /* eslint-disable global-require */
        plugin = require('../../plugins/coverage');
        /* eslint-enable global-require */

        server = new hapi.Server();
        server.connection({
            port: 1234
        });

        server.auth.scheme('custom', () => ({
            authenticate: (request, h) =>
                h.authenticated({
                    credentials: {
                        scope: ['build']
                    }
                })
        }));
        server.auth.strategy('token', 'custom');

        server.register(
            [
                {
                    register: plugin,
                    options: {
                        coveragePlugin: mockCoveragePlugin
                    }
                }
            ],
            err => {
                done(err);
            }
        );
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
        it('returns 200', () =>
            server
                .inject({
                    url: '/coverage/token',
                    credentials: {
                        jobId: 123,
                        scope: ['build']
                    }
                })
                .then(reply => {
                    assert.equal(reply.statusCode, 200);
                    assert.deepEqual(reply.result, 'faketoken');
                }));

        it('returns 500 if failed to get access token', () => {
            mockCoveragePlugin.getAccessToken.rejects(new Error('oops!'));

            return server
                .inject({
                    url: '/coverage/token',
                    credentials: {
                        jobId: 123,
                        scope: ['build']
                    }
                })
                .then(reply => {
                    assert.equal(reply.statusCode, 500);
                });
        });
    });

    describe('GET /coverage/info', () => {
        const startTime = '2017-10-19T13%3A00%3A00%2B0200';
        const endTime = '2017-10-19T15%3A00%3A00%2B0200';
        const args = {
            buildId: '1',
            jobId: '123',
            startTime: '2017-10-19T13:00:00+0200',
            endTime: '2017-10-19T15:00:00+0200'
        };
        const options = {
            // eslint-disable-next-line
            url: `/coverage/info?buildId=1&jobId=123&startTime=${startTime}&endTime=${endTime}`,
            credentials: {
                scope: ['user']
            }
        };
        const result = {
            coverage: '98.8',
            projectUrl: 'https://sonar.sd.cd/dashboard?id=job%3A123'
        };

        it('returns 200', () => {
            mockCoveragePlugin.getInfo.withArgs(args).resolves(result);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, result);
            });
        });

        it('returns 500 if failed to get info', () => {
            mockCoveragePlugin.getInfo.withArgs(args).rejects(new Error('oops!'));

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });
});
