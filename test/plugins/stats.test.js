'use strict';

const { assert } = require('chai');
const sinon = require('sinon');
const hapi = require('@hapi/hapi');

sinon.assert.expose(assert, { prefix: '' });

describe('stats plugin test', () => {
    let plugin;
    let server;
    let mockExecutorStats;
    let mockScmStats;

    beforeEach(async () => {
        mockExecutorStats = {
            stats: sinon.stub()
        };
        mockScmStats = {
            stats: sinon.stub()
        };

        /* eslint-disable global-require */
        plugin = require('../../plugins/stats');
        /* eslint-enable global-require */

        server = new hapi.Server({
            port: 1234
        });

        await server.register([
            {
                plugin,
                options: {
                    executor: mockExecutorStats,
                    scm: mockScmStats
                }
            }
        ]);
    });

    afterEach(() => {
        server = null;
    });

    it('registers the plugin', () => {
        assert.isOk(server.registrations.stats);
    });

    describe('GET /stats', () => {
        it('returns 200 for a successful yaml', () => {
            const mockExecutorReturn = {
                requests: {
                    total: 0,
                    timeouts: 0,
                    success: 0,
                    failure: 0,
                    concurrent: 0,
                    averageTime: 0
                },
                breaker: {
                    isClosed: false
                }
            };
            const mockScmReturn = { 'github:github.com': mockExecutorReturn };

            mockExecutorStats.stats.returns(mockExecutorReturn);
            mockScmStats.stats.returns(mockScmReturn);

            return server
                .inject({
                    url: '/stats'
                })
                .then(reply => {
                    assert.equal(reply.statusCode, 200);
                    assert.deepEqual(reply.result, {
                        executor: mockExecutorReturn,
                        scm: mockScmReturn
                    });
                });
        });
    });
});
