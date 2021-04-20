'use strict';

const Redis = require('ioredis');
const Redlock = require('redlock');
const config = require('config');
const logger = require('screwdriver-logger');

class Lock {
    /**
     * Constructor
     */
    constructor() {
        if (config.get('redisLock.enabled')) {
            const redisLockConfig = config.get('redisLock.options');
            const connectionDetails = {
                host: redisLockConfig.redisConnection.host,
                options: {
                    password:
                        redisLockConfig.redisConnection.options && redisLockConfig.redisConnection.options.password,
                    tls: redisLockConfig.redisConnection.options ? redisLockConfig.redisConnection.options.tls : false
                },
                port: redisLockConfig.redisConnection.port
            };

            try {
                this.redis = new Redis(connectionDetails.port, connectionDetails.host, connectionDetails.options);
                this.redlock = new Redlock([this.redis], {
                    driftFactor: redisLockConfig.driftFactor,
                    retryCount: redisLockConfig.retryCount,
                    retryDelay: redisLockConfig.retryDelay,
                    retryJitter: redisLockConfig.retryJitter
                });
            } catch (err) {
                logger.error('Failed to initialize redlock', err);
            }
        }
    }

    /**
     * Attempt to acquire a lock for resource, will retry acquiring lock depending
     * on configuration.
     * @method  lock
     * @param   {String}      resource      the string identifier for the resource to lock
     * @param   {Number}      ttl           maximum lock duration in milliseconds
     * @returns {Promise}
     */
    async lock(resource, ttl = 20000) {
        if (this.redlock) {
            try {
                const lock = await this.redlock.lock(resource, ttl);

                return lock;
            } catch (err) {
                logger.error(`Failed to lock ${resource}`, err);
            }
        }

        return null;
    }

    /**
     * Attempt to release a lock for resource.
     *
     * @method  unlock
     * @param   {Object}   lock      Lock representing the resource
     * @param   {String}   resource  the string identifier for the resource to lock
     * @returns {Promise}
     */
    async unlock(lock, resource) {
        try {
            if (lock) {
                const wait = await lock.unlock();

                return wait;
            }
        } catch (err) {
            logger.error(`Failed to unlock ${resource}`, err);
        }

        return null;
    }
}

module.exports = new Lock();
