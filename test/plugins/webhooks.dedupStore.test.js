'use strict';

const chai = require('chai');
const sinon = require('sinon');
const rewiremock = require('rewiremock/node');
const { assert } = chai;

chai.use(require('chai-as-promised'));
sinon.assert.expose(assert, { prefix: '' });

describe('webhook dedup store', () => {
    /**
     * Build a config mock that returns the given replayProtection block when
     * the dedupStore singleton constructor reads
     *   config.get('webhooks.replayProtection')
     * at module load time.
     * @param  {Object} replayProtection
     * @returns {Object}
     */
    function makeConfigMock(replayProtection) {
        return {
            has: key => key === 'webhooks.replayProtection' && replayProtection !== undefined,
            get: key => {
                if (key === 'webhooks.replayProtection') {
                    return replayProtection || {};
                }
                throw new Error(`Unexpected config.get(${key})`);
            }
        };
    }

    /**
     * Load the dedupStore module with config + lock replaced. The module
     * exports a singleton, so the returned value is the configured instance.
     * @param  {Object} options
     * @param  {Object} [options.replayProtection]  config block driving the singleton
     * @param  {Object} [options.lockMock]          replacement for plugins/lock
     * @returns {Object} the dedupStore singleton
     */
    function loadStore({ replayProtection, lockMock } = {}) {
        return rewiremock.proxy('../../plugins/webhooks/dedupStore', {
            config: makeConfigMock(replayProtection),
            '../../plugins/lock': lockMock || { redis: null }
        });
    }

    afterEach(() => {
        sinon.restore();
    });

    describe('when disabled', () => {
        it('claim() always returns true', async () => {
            const store = loadStore({ replayProtection: { enabled: false } });

            assert.isTrue(await store.claim('any'));
            assert.isTrue(await store.claim('any'));
        });

        it('claim() returns true when the replayProtection block is missing entirely', async () => {
            const store = loadStore();

            assert.isTrue(await store.claim('any'));
        });
    });

    describe('Redis backend (shared lock.redis client)', () => {
        let redisSet;

        beforeEach(() => {
            redisSet = sinon.stub();
        });

        it('returns true when SET NX succeeds (fresh delivery)', async () => {
            redisSet.resolves('OK');
            const store = loadStore({
                replayProtection: { enabled: true, ttlSeconds: 60 },
                lockMock: { redis: { set: redisSet, on: sinon.stub() } }
            });

            assert.isTrue(await store.claim('webhook:gh:1'));
            assert.calledWith(redisSet, 'webhook:gh:1', '1', 'EX', 60, 'NX');
        });

        it('returns false when SET NX reports the key already exists (duplicate)', async () => {
            redisSet.resolves(null);
            const store = loadStore({
                replayProtection: { enabled: true, ttlSeconds: 60 },
                lockMock: { redis: { set: redisSet, on: sinon.stub() } }
            });

            assert.isFalse(await store.claim('webhook:gh:2'));
        });

        it('fails open when the Redis call throws', async () => {
            redisSet.rejects(new Error('ECONNREFUSED'));
            const store = loadStore({
                replayProtection: { enabled: true, ttlSeconds: 60 },
                lockMock: { redis: { set: redisSet, on: sinon.stub() } }
            });

            assert.isTrue(await store.claim('webhook:gh:3'));
        });

        it('uses the default 5-minute TTL when ttlSeconds is omitted', async () => {
            redisSet.resolves('OK');
            const store = loadStore({
                replayProtection: { enabled: true },
                lockMock: { redis: { set: redisSet, on: sinon.stub() } }
            });

            await store.claim('webhook:gh:4');
            assert.calledWith(redisSet, 'webhook:gh:4', '1', 'EX', 300, 'NX');
        });
    });

    describe('in-memory fallback (lock.redis unavailable)', () => {
        let clock;

        beforeEach(() => {
            clock = sinon.useFakeTimers();
        });

        afterEach(() => {
            clock.restore();
        });

        it('first claim returns true, duplicate returns false', async () => {
            const store = loadStore({ replayProtection: { enabled: true, ttlSeconds: 60 } });

            assert.isTrue(await store.claim('mem-1'));
            assert.isFalse(await store.claim('mem-1'));
        });

        it('keys expire after the TTL window', async () => {
            const store = loadStore({ replayProtection: { enabled: true, ttlSeconds: 1 } });

            assert.isTrue(await store.claim('mem-2'));
            assert.isFalse(await store.claim('mem-2'));

            // Advance past the TTL.
            clock.tick(1500);

            assert.isTrue(await store.claim('mem-2'));
        });

        it('tracks different keys independently', async () => {
            const store = loadStore({ replayProtection: { enabled: true, ttlSeconds: 60 } });

            assert.isTrue(await store.claim('mem-a'));
            assert.isTrue(await store.claim('mem-b'));
            assert.isFalse(await store.claim('mem-a'));
            assert.isFalse(await store.claim('mem-b'));
        });

        it('falls back when lock module has no redis client', async () => {
            const store = loadStore({
                replayProtection: { enabled: true, ttlSeconds: 60 },
                lockMock: { redis: undefined }
            });

            assert.isTrue(await store.claim('mem-c'));
            assert.isFalse(await store.claim('mem-c'));
        });
    });
});
