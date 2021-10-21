'use strict';

const { assert } = require('chai');
const sinon = require('sinon');
const mockery = require('mockery');

/* eslint max-classes-per-file: ["error", 2] */
class RedisMock {
    constructor(port, host, options) {
        this.port = port;
        this.host = host;
        this.options = options;
    }
}

class RedLockMock {
    constructor(redisList, options) {
        this.redisList = redisList;
        this.options = options;
    }
}

sinon.assert.expose(assert, { prefix: '' });

describe('lock plugin test', () => {
    before(() => {
        mockery.enable({
            useCleanCache: true,
            warnOnUnregistered: false
        });

        mockery.registerMock('ioredis', RedisMock);
        mockery.registerMock('redlock', RedLockMock);
    });

    afterEach(() => {
        mockery.resetCache();
    });

    describe('disable redis lock test', () => {
        it('default disable', () => {
            /* eslint-disable global-require */
            const plugin = require('../../plugins/lock');
            /* eslint-enable global-require */

            assert.equal(plugin.redis, undefined);
            assert.equal(plugin.redlock, undefined);
        });

        it('explicitly disable', () => {
            process.env.REDLOCK_ENABLED = 'false';

            /* eslint-disable global-require */
            const plugin = require('../../plugins/lock');
            /* eslint-enable global-require */

            assert.equal(plugin.redis, undefined);
            assert.equal(plugin.redlock, undefined);
        });
    });

    describe('enable redis lock test', () => {
        it('enabled by boolean true', () => {
            process.env.REDLOCK_ENABLED = true;

            /* eslint-disable global-require */
            const plugin = require('../../plugins/lock');
            /* eslint-enable global-require */

            assert.instanceOf(plugin.redis, RedisMock);
            assert.instanceOf(plugin.redlock, RedLockMock);
        });

        it('enabled by string true', () => {
            process.env.REDLOCK_ENABLED = 'true';

            /* eslint-disable global-require */
            const plugin = require('../../plugins/lock');
            /* eslint-enable global-require */

            assert.instanceOf(plugin.redis, RedisMock);
            assert.instanceOf(plugin.redlock, RedLockMock);
        });
    });

    describe('redis options test', () => {
        before(() => {
            process.env.REDLOCK_ENABLED = true;
        });

        it('default values test', () => {
            /* eslint-disable global-require */
            const plugin = require('../../plugins/lock');
            /* eslint-enable global-require */

            const { redis, redlock } = plugin;

            assert.strictEqual(redis.host, '127.0.0.1');
            assert.strictEqual(redis.port, 9999);
            assert.deepEqual(redis.options, {
                password: 'THIS-IS-A-PASSWORD',
                tls: false
            });

            assert.deepEqual(redlock.redisList, [redis]);
            assert.deepEqual(redlock.options, {
                driftFactor: 0.01,
                retryCount: 200,
                retryDelay: 500,
                retryJitter: 200
            });
            assert.equal(plugin.ttl, 20000);
        });

        it('change options test', () => {
            process.env.REDLOCK_REDIS_HOST = '127.0.0.2';
            process.env.REDLOCK_REDIS_PORT = 9090;
            process.env.REDLOCK_REDIS_PASSWORD = 'password';
            process.env.REDLOCK_REDIS_TLS_ENABLED = true;

            process.env.REDLOCK_DRIFT_FACTOR = 0.02;
            process.env.REDLOCK_RETRY_COUNT = 100;
            process.env.REDLOCK_RETRY_DELAY = 200;
            process.env.REDLOCK_RETRY_JITTER = 300;
            process.env.REDLOCK_TTL = 40000;

            /* eslint-disable global-require */
            const plugin = require('../../plugins/lock');
            /* eslint-enable global-require */

            const { redis, redlock } = plugin;

            assert.strictEqual(redis.host, '127.0.0.2');
            assert.strictEqual(redis.port, '9090');
            assert.deepEqual(redis.options, {
                password: 'password',
                tls: true
            });

            assert.deepEqual(redlock.redisList, [redis]);
            assert.deepEqual(redlock.options, {
                driftFactor: 0.02,
                retryCount: 100,
                retryDelay: 200,
                retryJitter: 300
            });
            assert.equal(plugin.ttl, 40000);
        });

        it('string options parse test', () => {
            process.env.REDLOCK_REDIS_TLS_ENABLED = 'true';

            process.env.REDLOCK_DRIFT_FACTOR = '0.02';
            process.env.REDLOCK_RETRY_COUNT = '100';
            process.env.REDLOCK_RETRY_DELAY = '200';
            process.env.REDLOCK_RETRY_JITTER = '300';
            process.env.REDLOCK_TTL = '40000';

            /* eslint-disable global-require */
            const plugin = require('../../plugins/lock');
            /* eslint-enable global-require */

            const { redis, redlock } = plugin;

            assert.strictEqual(redis.options.tls, true);
            assert.deepEqual(redlock.redisList, [redis]);
            assert.deepEqual(redlock.options, {
                driftFactor: 0.02,
                retryCount: 100,
                retryDelay: 200,
                retryJitter: 300
            });
            assert.equal(plugin.ttl, 40000);
        });
    });
});
