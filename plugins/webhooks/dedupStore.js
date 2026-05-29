'use strict';

const config = require('config');
const logger = require('screwdriver-logger');
const lock = require('../lock');
const { parseBool } = require('../helper');

/**
 * Webhook replay-protection store. Tracks `x-github-delivery` IDs (or the
 * equivalent for other SCMs) for a short TTL and reports whether an incoming
 * delivery is fresh or a duplicate.
 *
 * Reuses the Redis client that plugins/lock.js creates from
 * redisLock.options. When that client is unavailable (redisLock.enabled is
 * false, or Redis init failed), falls back to a per-process in-memory Map.
 * The in-memory path is per-process and does NOT protect across multiple API
 * instances — it's a fail-degraded fallback for deployments where Redis is
 * unavailable.
 *
 * All errors are caught and the caller is told the delivery is fresh
 * (fail-open) — webhook processing is never blocked because of replay-
 * protection infrastructure failure.
 *
 * Exported as a singleton, mirroring plugins/lock.js.
 */
class WebhookDedupStore {
    /**
     * Read config and initialize the store. webhooks.replayProtection holds
     *   { enabled: Boolean, ttlSeconds: Number }
     * Redis is sourced from plugins/lock.js, which is in turn driven by
     * redisLock.options — operators configure one Redis target, both features
     * use it.
     */
    constructor() {
        // Tolerate `replayProtection: null` in YAML — config.has() reports
        // true but config.get() returns null in that case. Coalesce to {}
        // so the rest of the constructor reads default values.
        const options =
            (config.has('webhooks.replayProtection') ? config.get('webhooks.replayProtection') : null) || {};

        this.enabled = parseBool(options.enabled);
        this.ttlSeconds = parseInt(options.ttlSeconds, 10) || 300;

        if (!this.enabled) {
            this.redis = null;
            this.memorySeen = null;

            return;
        }

        this.redis = lock.redis || null;
        this.memorySeen = this.redis ? null : new Map();

        if (this.redis) {
            // ioredis emits 'error' events on connection / protocol failures.
            // Without a listener, an unhandled error event crashes the Node
            // process. lock.js owns this client but doesn't register a
            // handler, so we register one here. Listener is attached once
            // because dedupStore is a module-level singleton.
            this.redis.on('error', err => {
                logger.warn(`Webhook dedup store: Redis error (failing open): ${err.message}`);
            });
        } else {
            logger.info(
                'Webhook dedup store: Redis not available (redisLock disabled or uninitialized), using in-memory fallback (single-instance protection only)'
            );
        }
    }

    /**
     * Attempt to claim a dedup key. Returns true if this is the first time the
     * key has been seen within the TTL window (fresh delivery — proceed), or
     * false if the key was already claimed (duplicate — reject upstream).
     *
     * Any infrastructure error returns true (fail-open).
     *
     * @method claim
     * @param  {String} key
     * @returns {Promise<Boolean>} true if fresh, false if duplicate
     */
    async claim(key) {
        if (!this.enabled) {
            return true;
        }

        if (this.redis) {
            try {
                // SET key 1 EX <ttl> NX — atomic test-and-set with TTL.
                // Resolves to 'OK' on success, null if the key already exists.
                const result = await this.redis.set(key, '1', 'EX', this.ttlSeconds, 'NX');

                return result === 'OK';
            } catch (err) {
                logger.warn(`Webhook dedup store: claim failed (failing open): ${err.message}`);

                return true;
            }
        }

        // In-memory fallback path. Constructor guarantees memorySeen is set
        // here (when enabled and lock.redis is unavailable).
        if (this.memorySeen.has(key)) {
            return false;
        }
        this.memorySeen.set(key, true);
        setTimeout(() => this.memorySeen.delete(key), this.ttlSeconds * 1000).unref();

        return true;
    }
}

module.exports = new WebhookDedupStore();
