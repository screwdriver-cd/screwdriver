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
 */
const versionsTemplate = {
    name: 'versions',
    async register(server) {
        // Designed to match Screwdriver specific packages
        const SD_REGEX = /^screwdriver-/;
        let start = process.cwd();

        if (!fs.existsSync(path.resolve(process.cwd(), './node_modules'))) {
            start = path.resolve(process.cwd(), '../..');
        }

        // Load licenses
        return checker.init(
            {
                production: true,
                start
            },
            (err, json) => {
                if (err) {
                    throw new VError(err, 'Unable to load package dependencies');
                } else {
                    const depArray = Object.keys(json).map(key => ({ name: key, ...json[key] }));
                    const depDisplay = depArray.map(dep => ({
                        name: dep.name
                            .split('@')
                            .slice(0, -1)
                            .join('@'),
                        repository: dep.repository || 'UNKNOWN',
                        licenses: dep.licenses || 'UNKNOWN'
                    }));
                    const sdVersions = depArray.filter(dep => SD_REGEX.test(dep.name)).map(dep => dep.name);

                    server.route({
                        method: 'GET',
                        path: '/versions',
                        handler: (request, h) =>
                            h.response({
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
                }
            }
        );
    }
};

module.exports = versionsTemplate;
