'use strict';

const checker = require('license-checker');
const fs = require('fs');
const path = require('path');
const process = require('process');
const VError = require('verror');
const schema = require('screwdriver-data-schema');

/**
 * Hapi interface for plugin to return package list
 * @method register
 * @param  {Hapi.Server}    server
 * @param  {Object}         options
 * @param  {Function} next
 */
exports.register = (server, options, next) => {
    // Designed to match Screwdriver specific packages
    const SD_REGEX = /^screwdriver-/;
    let start = process.cwd();

    if (!fs.existsSync(path.resolve(process.cwd(), './node_modules'))) {
        start = path.resolve(process.cwd(), '../..');
    }

    // Load licenses
    checker.init({
        production: true,
        start
    }, (err, json) => {
        if (err) {
            return next(new VError(err, 'Unable to load package dependencies'));
        }

        const depArray = Object.keys(json).map(key => Object.assign({ name: key }, json[key]));
        const depDisplay = depArray.map(dep => ({
            name: dep.name.split('@').slice(0, -1).join('@'),
            repository: dep.repository || 'UNKNOWN',
            licenses: dep.licenses || 'UNKNOWN'
        }));
        const sdVersions = depArray.filter(dep => SD_REGEX.test(dep.name)).map(dep => dep.name);

        server.route({
            method: 'GET',
            path: '/versions',
            handler: (request, reply) => reply({
                // List of Screwdriver package versions
                versions: sdVersions,
                // List of licenses for third-party dependencies
                licenses: depDisplay
            }),
            config: {
                description: 'API Package Versions',
                notes: 'Returns list of Screwdriver package versions and third-party dependencies',
                tags: ['api'],
                response: {
                    schema: schema.api.versions
                }
            }
        });

        return next();
    });
};

exports.register.attributes = {
    name: 'versions',
    version: '1.0.0'
};
