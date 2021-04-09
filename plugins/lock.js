'use strict';

const Redis = require('ioredis');
const Redlock = require('redlock');
const config = require('config');

class Lock {
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

            this.redis = new Redis(connectionDetails.port, connectionDetails.host, connectionDetails.options);
            this.redlock = new Redlock([this.redis], {
                driftFactor: redisLockConfig.driftFactor,
                retryCount: redisLockConfig.retryCount,
                retryDelay: redisLockConfig.retryDelay,
                retryJitter: redisLockConfig.retryJitter
            });
        }
    }

    getLock(resource, ttl) {
        if (this.redlock) {
            return this.redlock.lock(resource, ttl);
        }

        return null;
    }
}

module.exports = new Lock();
