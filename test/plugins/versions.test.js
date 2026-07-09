'use strict';

const fs = require('fs');
const path = require('path');
const process = require('process');
const { assert } = require('chai');
const hapi = require('@hapi/hapi');
const sinon = require('sinon');

sinon.assert.expose(assert, { prefix: '' });

describe('versions plugin test', () => {
    const root = '/app';
    const packageJsons = {
        '/app/package.json': {
            name: 'test',
            version: '1.0.0',
            license: 'MIT',
            repository: {
                type: 'git',
                url: 'git@github.com:screwdriver-cd/screwdriver.git'
            },
            dependencies: {
                'screwdriver-foo': '^0.1.2',
                fake1: '^1.2.3',
                fake3: '^3.4.5',
                fake2: '^2.3.4'
            }
        },
        '/app/node_modules/screwdriver-foo/package.json': {
            name: 'screwdriver-foo',
            version: '0.1.2',
            repository: 'bar',
            license: 'baz'
        },
        '/app/node_modules/fake1/package.json': {
            name: 'fake1',
            version: '1.2.3',
            repository: 'bark1'
        },
        '/app/node_modules/fake2/package.json': {
            name: 'fake2',
            version: '2.3.4',
            license: 'bark2'
        },
        '/app/node_modules/fake3/package.json': {
            name: 'fake3',
            version: '3.4.5',
            repository: 'bark3',
            license: 'bark4'
        }
    };

    /**
     * Generate a new Hapi server with a specified init function
     * @method registerServer
     * @return {HapiServer}                  Hapi Server to use
     */
    async function registerServer() {
        /* eslint-disable global-require */
        const plugin = require('../../plugins/versions');
        /* eslint-enable global-require */

        const server = new hapi.Server({
            port: 1234
        });

        await server.register({ plugin });

        return server;
    }

    beforeEach(() => {
        sinon.stub(process, 'cwd').returns(root);
    });

    afterEach(() => {
        sinon.restore();
    });

    describe('GET /versions', () => {
        it('returns 200 for a successful response', async () => {
            const originalExistsSync = fs.existsSync;
            const originalReadFileSync = fs.readFileSync;

            sinon.stub(fs, 'existsSync').callsFake(filePath => {
                const normalized = path.normalize(filePath);

                if (normalized === '/app/node_modules' || packageJsons[normalized]) {
                    return true;
                }

                return originalExistsSync.call(fs, filePath);
            });

            sinon.stub(fs, 'readFileSync').callsFake((filePath, ...args) => {
                const normalized = path.normalize(filePath);

                if (packageJsons[normalized]) {
                    return JSON.stringify(packageJsons[normalized]);
                }

                return originalReadFileSync.call(fs, filePath, ...args);
            });

            sinon.stub(fs, 'readdirSync').callsFake(() => []);
            sinon.stub(fs, 'lstatSync').callsFake(() => ({
                isFile: () => true
            }));

            const server = await registerServer();
            const reply = await server.inject({ url: '/versions' });

            assert.equal(reply.statusCode, 200);
            assert.deepEqual(reply.result.versions, ['screwdriver-foo@0.1.2']);
            assert.deepEqual(reply.result.licenses, [
                { name: 'fake1', repository: 'https://github.com/bark1', licenses: 'UNKNOWN' },
                { name: 'fake2', repository: 'UNKNOWN', licenses: 'bark2' },
                { name: 'fake3', repository: 'https://github.com/bark3', licenses: 'bark4' },
                { name: 'screwdriver-foo', repository: 'https://github.com/bar', licenses: 'baz' },
                {
                    name: 'test',
                    repository: 'https://github.com/screwdriver-cd/screwdriver',
                    licenses: 'MIT'
                }
            ]);
        });

        it('returns 500 for being unable to parse the package.json', async () => {
            sinon.stub(fs, 'existsSync').callsFake(filePath => {
                const normalized = path.normalize(filePath);

                return normalized === '/app/node_modules' || normalized === '/app/package.json';
            });

            sinon.stub(fs, 'readFileSync').throws(new Error('foobar'));

            registerServer().catch(error => {
                assert.match(error.toString(), /Unable to load package dependencies: foobar/);
            });
        });
    });
});
