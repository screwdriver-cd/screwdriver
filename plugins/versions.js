'use strict';

const fs = require('fs');
const path = require('path');
const process = require('process');
const VError = require('verror');
const schema = require('screwdriver-data-schema');

const UNKNOWN = 'UNKNOWN';
const UNLICENSED = 'UNLICENSED';
const SD_REGEX = /^screwdriver-/;

/**
 * Read JSON file
 * @param {string} filePath File path
 * @returns {Object}
 */
function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

/**
 * Resolve project root path
 * @returns {string}
 */
function findProjectRoot() {
    if (fs.existsSync(path.resolve(process.cwd(), './node_modules'))) {
        return process.cwd();
    }

    return path.resolve(process.cwd(), '../..');
}

/**
 * Normalize repository url
 * @param {Object|string} repository Repository URL
 * @returns {string}
 */
function normalizeRepository(repository) {
    const url = typeof repository === 'string' ? repository : repository && repository.url;

    if (!url) {
        return undefined;
    }

    const normalizedUrl = url
        .replace('http:', 'https:')
        .replace('ssh://github.com', 'https://github.com')
        .replace('git+ssh://git@', 'git://')
        .replace('git+https://github.com', 'https://github.com')
        .replace('git://github.com', 'https://github.com')
        .replace('git@github.com:', 'https://github.com/')
        .replace('www.github.com', 'github.com')
        .replace('github:', '')
        .replace(/\.git$/, '');

    return normalizedUrl.startsWith('http') ? normalizedUrl : `https://github.com/${normalizedUrl}`;
}

/**
 * Normalize license
 * @param {Array|string} value license
 * @returns {string}
 */
function normalizeLicense(value) {
    if (!value) {
        return undefined;
    }

    if (Array.isArray(value)) {
        const licenses = value
            .map(item => {
                if (typeof item === 'string') {
                    return item;
                }

                return item && (item.type || item.name);
            })
            .filter(Boolean);

        return licenses.length === 1 ? licenses[0] : licenses;
    }

    if (typeof value === 'object') {
        return value.type || value.name;
    }

    return value;
}

/**
 * Find license description from the document
 * @param {string} text document
 * @returns {string}
 */
function detectLicenseFromText(text) {
    if (!text) {
        return undefined;
    }

    const body = text.toLowerCase();

    if (body.includes('mit license')) {
        return 'MIT';
    }

    if (body.includes('apache license') && body.includes('version 2.0')) {
        return 'Apache-2.0';
    }

    if (body.includes('isc license')) {
        return 'ISC';
    }

    if (body.includes('bsd 3-clause')) {
        return 'BSD-3-Clause';
    }

    if (body.includes('bsd 2-clause')) {
        return 'BSD-2-Clause';
    }

    return undefined;
}

/**
 * Find license files
 * @param {string} dir base directory
 * @returns {Array}
 */
function getLicenseFiles(dir) {
    return fs
        .readdirSync(dir)
        .filter(filename => {
            const upper = filename.toUpperCase();
            const basename = path.basename(upper, path.extname(upper));

            return (
                basename === 'LICENSE' || basename === 'LICENCE' || basename === 'COPYING' || basename === 'COPYRIGHT'
            );
        })
        .sort();
}

/**
 * Find package directory
 * @param {string} fromDir base directory
 * @param {string} name package name
 * @returns {string}
 */
function resolvePackageDir(fromDir, name) {
    let current = fromDir;

    while (current && current !== path.dirname(current)) {
        const candidate = path.join(current, 'node_modules', name);

        if (fs.existsSync(path.join(candidate, 'package.json'))) {
            return candidate;
        }

        current = path.dirname(current);
    }

    return null;
}

/**
 * List up packages infomation
 * @param {string} pkgDir base dirctory
 * @param {object} data result store
 * @returns {object}
 */
function collectPackage(pkgDir, data) {
    const packageJsonPath = path.join(pkgDir, 'package.json');

    if (!fs.existsSync(packageJsonPath)) {
        return data;
    }

    const json = readJson(packageJsonPath);
    const key = `${json.name}@${json.version}`;

    if (!json.name || !json.version || data[key]) {
        return data;
    }

    const moduleInfo = {
        licenses: UNKNOWN
    };

    if (json.private) {
        moduleInfo.private = true;
    }

    const repository = normalizeRepository(json.repository);

    if (repository) {
        moduleInfo.repository = repository;
    }

    let licenses = normalizeLicense(json.license || json.licenses);

    if (!licenses && json.readme) {
        licenses = detectLicenseFromText(json.readme);
    }

    const readmePath = path.join(pkgDir, 'README.md');

    if (!licenses && fs.existsSync(readmePath)) {
        licenses = detectLicenseFromText(fs.readFileSync(readmePath, 'utf8'));
    }

    getLicenseFiles(pkgDir).forEach((filename, index) => {
        const licenseFile = path.join(pkgDir, filename);

        if (!fs.lstatSync(licenseFile).isFile()) {
            return;
        }

        const content = fs.readFileSync(licenseFile, 'utf8');

        if (!licenses || String(licenses).includes(UNKNOWN) || String(licenses).indexOf('Custom:') === 0) {
            licenses = detectLicenseFromText(content) || `Custom: ${filename}`;
        }

        if (index === 0) {
            moduleInfo.licenseFile = licenseFile;
        }
    });

    moduleInfo.licenses = licenses || UNKNOWN;

    if (json.private) {
        moduleInfo.licenses = UNLICENSED;
    }

    data[key] = moduleInfo;

    [json.dependencies, json.optionalDependencies, json.peerDependencies].forEach(dependencies => {
        Object.keys(dependencies || {}).forEach(depName => {
            const childDir = resolvePackageDir(pkgDir, depName);

            if (childDir) {
                collectPackage(childDir, data);
            }
        });
    });

    return data;
}

const versionsTemplate = {
    name: 'versions',

    async register(server) {
        try {
            const data = collectPackage(findProjectRoot(), {});

            const depArray = Object.keys(data)
                .sort()
                .map(key => ({
                    name: key,
                    ...data[key]
                }));

            const depDisplay = depArray.map(dep => ({
                name: dep.name.split('@').slice(0, -1).join('@'),
                repository: dep.repository || UNKNOWN,
                licenses: dep.licenses || UNKNOWN
            }));

            const sdVersions = depArray.filter(dep => SD_REGEX.test(dep.name)).map(dep => dep.name);

            return server.route({
                method: 'GET',
                path: '/versions',
                handler: (request, h) =>
                    h.response({
                        versions: sdVersions,
                        licenses: depDisplay
                    }),
                config: {
                    description: 'API Package Versions',
                    notes: 'Returns list of Screwdriver package versions and third-party dependencies',
                    tags: ['api'],
                    plugins: {
                        'hapi-rate-limit': {
                            enabled: false
                        }
                    },
                    response: {
                        schema: schema.api.versions
                    }
                }
            });
        } catch (err) {
            throw new VError(err, 'Unable to load package dependencies');
        }
    }
};

module.exports = versionsTemplate;
