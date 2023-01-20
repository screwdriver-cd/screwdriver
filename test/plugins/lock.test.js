'use strict';

const importFresh = require('import-fresh');
const { assert } = require('chai');
const sinon = require('sinon');
const rewiremock = require('rewiremock/node');

/* eslint max-classes-per-file: ["error", 2] */
class RedisMock {
    constructor(port, host, options) {
        this.port = port;
        this.host = host;
        this.options = options;
    }
}

class RedisClusterMock {
    constructor(hosts, options) {
        this.hosts = hosts;
        this.options = options;
    }
}

RedisMock.Cluster = RedisClusterMock;

/* eslint max-classes-per-file: ["error", 3] */
class RedLockMock {
    constructor(redisList, options) {
        this.redisList = redisList;
        this.options = options;
    }
}

sinon.assert.expose(assert, { prefix: '' });

describe('lock plugin test', () => {
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

            const testConfig = importFresh('config');
            /* eslint-disable prettier/prettier */
            const plugin = rewiremock.proxy('../../plugins/lock', {
                'config': testConfig,
                'ioredis': RedisMock,
                'redlock': RedLockMock
            });
            /* eslint-enable prettier/prettier */

            assert.equal(plugin.redis, undefined);
            assert.equal(plugin.redlock, undefined);
        });
    });

    describe('enable redis lock test', () => {
        it('enabled by boolean true', () => {
            process.env.REDLOCK_ENABLED = true;

            const testConfig = importFresh('config');
            /* eslint-disable prettier/prettier */
            const plugin = rewiremock.proxy('../../plugins/lock', {
                'config': testConfig,
                'ioredis': RedisMock,
                'redlock': RedLockMock
            });
            /* eslint-enable prettier/prettier */

            assert.instanceOf(plugin.redis, RedisMock);
            assert.instanceOf(plugin.redlock, RedLockMock);
        });

        it('enabled by string true', () => {
            process.env.REDLOCK_ENABLED = 'true';

            const testConfig = importFresh('config');
            /* eslint-disable prettier/prettier */
            const plugin = rewiremock.proxy('../../plugins/lock', {
                'config': testConfig,
                'ioredis': RedisMock,
                'redlock': RedLockMock
            });
            /* eslint-enable prettier/prettier */

            assert.instanceOf(plugin.redis, RedisMock);
            assert.instanceOf(plugin.redlock, RedLockMock);
        });
    });

    describe('redis options test', () => {
        before(() => {
            process.env.REDLOCK_ENABLED = true;
        });

        after(() => {
            delete process.env.REDLOCK_ENABLED;
            delete process.env.REDLOCK_REDIS_HOST;
            delete process.env.REDLOCK_REDIS_PORT;
            delete process.env.REDLOCK_REDIS_PASSWORD;
            delete process.env.REDLOCK_REDIS_TLS_ENABLED;
            delete process.env.REDLOCK_DRIFT_FACTOR;
            delete process.env.REDLOCK_RETRY_COUNT;
            delete process.env.REDLOCK_RETRY_DELAY;
            delete process.env.REDLOCK_RETRY_JITTER;
            delete process.env.REDLOCK_TTL;
        });

        it('default values test', () => {
            const testConfig = importFresh('config');
            /* eslint-disable prettier/prettier */
            const plugin = rewiremock.proxy('../../plugins/lock', {
                'config': testConfig,
                'ioredis': RedisMock,
                'redlock': RedLockMock
            });
            /* eslint-enable prettier/prettier */
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

            const testConfig = importFresh('config');
            /* eslint-disable prettier/prettier */
            const plugin = rewiremock.proxy('../../plugins/lock', {
                'config': testConfig,
                'ioredis': RedisMock,
                'redlock': RedLockMock
            });
            /* eslint-enable prettier/prettier */
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

            const testConfig = importFresh('config');
            /* eslint-disable prettier/prettier */
            const plugin = rewiremock.proxy('../../plugins/lock', {
                'config': testConfig,
                'ioredis': RedisMock,
                'redlock': RedLockMock
            });
            /* eslint-enable prettier/prettier */
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

    describe('redis cluster options test', () => {
        before(() => {
            process.env.REDLOCK_ENABLED = true;
            process.env.REDLOCK_REDIS_TYPE = 'redisCluster';
        });

        after(() => {
            delete process.env.REDLOCK_ENABLED;
            delete process.env.REDLOCK_REDIS_TYPE;
            delete process.env.REDLOCK_REDIS_PASSWORD;
            delete process.env.REDLOCK_REDIS_TLS_ENABLED;
            delete process.env.REDIS_CLUSTER_HOSTS;
            delete process.env.REDIS_CLUSTER_SLOTS_REFRESH_TIMEOUT;
        });

        it('default values test', () => {
            const testConfig = importFresh('config');
            /* eslint-disable prettier/prettier */
            const plugin = rewiremock.proxy('../../plugins/lock', {
                'config': testConfig,
                'ioredis': RedisMock,
                'redlock': RedLockMock
            });
            /* eslint-enable prettier/prettier */
            const { redis } = plugin;

            console.log('default value for tls', process.env.REDLOCK_REDIS_TLS_ENABLED);

            assert.deepEqual(redis.hosts, []);
            assert.deepEqual(redis.options.redisOptions, {
                password: 'THIS-IS-A-PASSWORD',
                tls: false
            });
            assert.strictEqual(redis.options.slotsRefreshTimeout, 1000);
            assert.strictEqual(redis.options.clusterRetryStrategy(), 100);
        });

        it('change options test', () => {
            process.env.REDLOCK_REDIS_CLUSTER_HOSTS = '["127.0.0.1:6379", "127.0.0.2:6379", "127.0.0.3:6379"]';
            process.env.REDLOCK_REDIS_CLUSTER_SLOTS_REFRESH_TIMEOUT = 100;
            process.env.REDLOCK_REDIS_PASSWORD = 'password';
            process.env.REDLOCK_REDIS_TLS_ENABLED = true;

            process.env.REDLOCK_DRIFT_FACTOR = 0.02;
            process.env.REDLOCK_RETRY_COUNT = 100;
            process.env.REDLOCK_RETRY_DELAY = 200;
            process.env.REDLOCK_RETRY_JITTER = 300;
            process.env.REDLOCK_TTL = 40000;

            const testConfig = importFresh('config');
            /* eslint-disable prettier/prettier */
            const plugin = rewiremock.proxy('../../plugins/lock', {
                'config': testConfig,
                'ioredis': RedisMock,
                'redlock': RedLockMock
            });
            /* eslint-enable prettier/prettier */
            const { redis } = plugin;

            assert.deepEqual(redis.hosts, ['127.0.0.1:6379', '127.0.0.2:6379', '127.0.0.3:6379']);
            assert.deepEqual(redis.options.redisOptions, {
                password: 'password',
                tls: true
            });
            assert.strictEqual(redis.options.slotsRefreshTimeout, 100);
            assert.strictEqual(redis.options.clusterRetryStrategy(), 100);
        });
    });

    describe('other redis type is specified', () => {
        before(() => {
            process.env.REDLOCK_ENABLED = true;
            process.env.REDLOCK_REDIS_TYPE = 'unknown';
        });

        after(() => {
            delete process.env.REDLOCK_ENABLED;
            delete process.env.REDLOCK_REDIS_TYPE;
        });

        it('occurs an error', () => {
            const testConfig = importFresh('config');

            try {
                /* eslint-disable prettier/prettier */
                rewiremock.proxy('../../plugins/lock', {
                    'config': testConfig,
                    'ioredis': RedisMock,
                    'redlock': RedLockMock
                });
                /* eslint-enable prettier/prettier */
            } catch (err) {
                assert.equal(
                    err.message,
                    "'connectionType unknown' is not supported, use 'redis' or 'redisCluster' for the queue.connectionType setting"
                );
            }
        });
    });
});
