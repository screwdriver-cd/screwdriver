'use strict';

const { createPlugin } = require('@promster/hapi');

/**
 * Hapi interface for plugin to collect the metrics in the hapi-server
 * @method register
 * @param  {Hapi.Server}    server
 * @param  {Object}         options
 * @param  {Function} next
 */
module.exports = {
    name: 'prompster',
    register: createPlugin({ options: { metricPrefix: 'sd_' } }),
    options: {}
};
