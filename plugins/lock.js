'use strict';

const Redis = require('ioredis');
const Redlock = require('redlock');
const config = require('config');
const logger = require('screwdriver-logger');

/**
 * parse value to Boolean
 * @method parseBool
 * @param {(Boolean|String)} value
 * @return {Boolean}
 */
function parseBool(value) {
    if (typeof value === 'boolean') {
        return value;
    }

    // True values refers to https://yaml.org/type/bool.html
    return ['on', 'true', 'yes', 'y'].includes(String(value).toLowerCase());
}

class Lock {
    /**
     * Constructor
     */
    constructor() {
        if (!parseBool(config.get('redisLock.enabled'))) {
            return;
        }

        const redisLockConfig = config.get('redisLock.options');
        const connectionType = redisLockConfig.connectionType;

        if (!connectionType && (connectionType !== 'redis' || connectionType !== 'redisCluster')) {
            throw new Error(
                `'${connectionType}' is not supported in connectionType, 'redis' or 'redisCluster' can be set for the queue.connectionType setting`
            );
        }

        const redisConfig = redisLockConfig[`${connectionType}Connection`];
        const redisOptions = {
            password: redisConfig.options && redisConfig.options.password,
            tls: redisConfig.options ? parseBool(redisConfig.options.tls) : false
        };

        try {
            if (connectionType === 'redisCluster') {
                this.redis = new Redis.Cluster(redisConfig.hosts, {
                    redisOptions,
                    slotsRefreshTimeout: parseInt(redisConfig.slotsRefreshTimeout, 10),
                    clusterRetryStrategy: () => 100
                });
            } else {
                this.redis = new Redis(redisConfig.port, redisConfig.host, redisOptions);
            }
            this.redlock = new Redlock([this.redis], {
                driftFactor: parseFloat(redisLockConfig.driftFactor),
                retryCount: parseInt(redisLockConfig.retryCount, 10),
                retryDelay: parseFloat(redisLockConfig.retryDelay),
                retryJitter: parseFloat(redisLockConfig.retryJitter)
            });
            this.ttl = parseFloat(redisLockConfig.ttl);
        } catch (err) {
            logger.error('Failed to initialize redlock', err);
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
    async lock(resource, ttl = this.ttl) {
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
