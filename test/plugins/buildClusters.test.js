'use strict';

const { assert } = require('chai');
const sinon = require('sinon');
const hapi = require('hapi');
const mockery = require('mockery');
const urlLib = require('url');
const hoek = require('hoek');
const testBuildCluster = require('./data/buildCluster.json');
const testBuildClusters = require('./data/buildClusters.json');
const updatedBuildCluster = require('./data/updatedBuildCluster.json');

sinon.assert.expose(assert, { prefix: '' });

const decorateBuildClusterObject = (buildCluster) => {
    const decorated = hoek.clone(buildCluster);

    decorated.update = sinon.stub().resolves(buildCluster);
    decorated.remove = sinon.stub().resolves({});
    decorated.toJson = sinon.stub().returns(buildCluster);

    return decorated;
};

const getMockBuildClusters = (buildClusters) => {
    if (Array.isArray(buildClusters)) {
        return buildClusters.map(decorateBuildClusterObject);
    }

    return decorateBuildClusterObject(buildClusters);
};

describe('buildCluster plugin test', () => {
    const username = 'myself';
    const scmContext = 'github:github.com';
    const buildClusterId = 12345;
    const name = 'iOS';
    const credentials = {
        scope: ['user'],
        username,
        scmContext
    };

    let buildClusterFactoryMock;
    let userFactoryMock;
    let bannerMock;
    let screwdriverAdminDetailsMock;
    let authMock;
    let plugin;
    let server;

    before(() => {
        mockery.enable({
            useCleanCache: true,
            warnOnUnregistered: false
        });
    });

    beforeEach((done) => {
        buildClusterFactoryMock = {
            create: sinon.stub(),
            list: sinon.stub(),
            scm: {
                getOrgPermissions: sinon.stub()
            }
        };
        userFactoryMock = {
            get: sinon.stub(),
            create: sinon.stub(),
            list: sinon.stub()
        };

        screwdriverAdminDetailsMock = sinon.stub().returns({ isAdmin: true });

        /* eslint-disable global-require */
        plugin = require('../../plugins/buildClusters');
        /* eslint-enable global-require */
        server = new hapi.Server();
        server.app = {
            buildClusterFactory: buildClusterFactoryMock,
            userFactory: userFactoryMock
        };
        server.connection({
            port: 12345,
            host: 'localhost'
        });

        server.auth.scheme('custom', () => ({
            authenticate: (request, reply) => reply.continue({
                credentials: {
                    scope: ['user']
                }
            })
        }));
        server.auth.strategy('token', 'custom');
        server.auth.strategy('session', 'custom');

        bannerMock = {
            register: (s, o, next) => {
                s.expose('screwdriverAdminDetails', screwdriverAdminDetailsMock);
                next();
            }
        };
        bannerMock.register.attributes = {
            name: 'banners'
        };

        authMock = {
            register: (s, o, next) => {
                next();
            }
        };
        authMock.register.attributes = {
            name: 'auth'
        };

        server.register([
            bannerMock, authMock,
            {
                register: plugin,
                options: {
                    authConfig: {
                        jwtPrivateKey: 'boo'
                    }
                }
            }, {
                // eslint-disable-next-line global-require
                register: require('../../plugins/pipelines')
            }
        ], done);
    });

    afterEach(() => {
        server.stop();
        server = null;
        mockery.deregisterAll();
        mockery.resetCache();
    });

    after(() => {
        mockery.disable();
    });

    it('registers the plugin', () => {
        assert.isOk(server.registrations.buildClusters);
    });

    describe('GET /buildclusters', () => {
        let options;

        beforeEach(() => {
            options = {
                method: 'GET',
                url: '/buildclusters',
                credentials
            };
        });

        it('returns 200 and all build clusters', () => {
            buildClusterFactoryMock.list.resolves(getMockBuildClusters(testBuildClusters));

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testBuildClusters);
            });
        });

        it('returns 500 when datastore fails', () => {
            buildClusterFactoryMock.list.rejects(new Error('fail'));

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('GET /buildclusters/{name}', () => {
        it('returns 200 for a build cluster that exists', () => {
            const buildClusterMock = getMockBuildClusters(testBuildCluster);

            buildClusterFactoryMock.list.withArgs({ params: { name } }).resolves(buildClusterMock);

            return server.inject(`/buildclusters/${name}`).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testBuildCluster);
            });
        });

        it('returns 404 when build does not exist', () => {
            buildClusterFactoryMock.list.withArgs({ params: { name } }).resolves(null);

            return server.inject(`/buildclusters/${name}`).then((reply) => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 500 when datastore returns an error', () => {
            buildClusterFactoryMock.list.withArgs({ params: { name } }).rejects(new Error('blah'));

            return server.inject(`/buildclusters/${name}`).then((reply) => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('POST /buildclusters', () => {
        const internalPayload = {
            name: 'k8s',
            description: 'Screwdriver build cluster using k8s',
            scmOrganizations: ['screwdriver-cd'],
            isActive: true,
            managedByScrewdriver: true,
            maintainer: 'foo@bar.com',
            weightage: 20
        };
        const internalParams = {
            name: 'k8s',
            description: 'Screwdriver build cluster using k8s',
            scmOrganizations: ['screwdriver-cd'],
            isActive: true,
            managedByScrewdriver: true,
            maintainer: 'foo@bar.com',
            weightage: 20,
            scmContext
        };
        let params = {
            name: 'iOS',
            description: 'Build cluster for iOS team',
            scmOrganizations: ['screwdriver-cd'],
            isActive: true,
            managedByScrewdriver: false,
            maintainer: 'foo@bar.com',
            weightage: 50,
            scmContext
        };

        let options;
        let userMock;
        let buildClusterMock;
        let scmConfig;

        beforeEach(() => {
            scmConfig = {
                token: 'iamtoken',
                scmContext,
                organization: 'screwdriver-cd',
                username
            };
            options = {
                method: 'POST',
                url: '/buildclusters',
                payload: {
                    name: 'iOS',
                    description: 'Build cluster for iOS team',
                    scmOrganizations: ['screwdriver-cd'],
                    isActive: true,
                    managedByScrewdriver: false,
                    maintainer: 'foo@bar.com',
                    weightage: 50
                },
                credentials
            };

            buildClusterMock = getMockBuildClusters({
                id: buildClusterId,
                other: 'dataToBeIncluded'
            });
            userMock = {
                username,
                unsealToken: sinon.stub()
            };

            userMock.unsealToken.resolves('iamtoken');
            buildClusterFactoryMock.create.resolves(buildClusterMock);
            buildClusterFactoryMock.scm.getOrgPermissions.resolves({
                admin: true,
                member: true
            });
            userFactoryMock.get.resolves(userMock);
        });

        it('returns 201 for a successful create for an external build cluster', () => {
            let expectedLocation;

            return server.inject(options).then((reply) => {
                expectedLocation = {
                    host: reply.request.headers.host,
                    port: reply.request.headers.port,
                    protocol: reply.request.server.info.protocol,
                    pathname: `${options.url}/${buildClusterId}`
                };
                assert.equal(reply.statusCode, 201);
                assert.deepEqual(reply.result, {
                    id: buildClusterId,
                    other: 'dataToBeIncluded'
                });
                assert.calledWith(buildClusterFactoryMock.scm.getOrgPermissions, scmConfig);
                assert.strictEqual(reply.headers.location, urlLib.format(expectedLocation));
                assert.calledWith(buildClusterFactoryMock.create, params);
            });
        });

        it('returns 201 for a successful create for an internal build cluster', () => {
            let expectedLocation;

            options.payload = internalPayload;
            params = internalParams;

            return server.inject(options).then((reply) => {
                expectedLocation = {
                    host: reply.request.headers.host,
                    port: reply.request.headers.port,
                    protocol: reply.request.server.info.protocol,
                    pathname: `${options.url}/${buildClusterId}`
                };
                assert.equal(reply.statusCode, 201);
                assert.deepEqual(reply.result, {
                    id: buildClusterId,
                    other: 'dataToBeIncluded'
                });
                assert.notCalled(buildClusterFactoryMock.scm.getOrgPermissions);
                assert.strictEqual(reply.headers.location, urlLib.format(expectedLocation));
                assert.calledWith(buildClusterFactoryMock.create, params);
            });
        });

        it('returns 422 when the no scm orgs provided for an external cluster', () => {
            options.payload.scmOrganizations = [];

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 422);
                assert.notCalled(buildClusterFactoryMock.scm.getOrgPermissions);
                assert.notCalled(buildClusterFactoryMock.create);
            });
        });

        it('returns 403 when the user is not an org admin for an external cluster', () => {
            buildClusterFactoryMock.scm.getOrgPermissions.resolves({
                admin: false,
                member: true
            });

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 403);
                assert.calledWith(buildClusterFactoryMock.scm.getOrgPermissions, scmConfig);
                assert.notCalled(buildClusterFactoryMock.create);
            });
        });

        it('returns 403 when the user is not a Screwdriver admin for an internal cluster', () => {
            options.payload = internalPayload;
            params = internalParams;
            screwdriverAdminDetailsMock.returns({ isAdmin: false });

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 403);
                assert.notCalled(buildClusterFactoryMock.scm.getOrgPermissions);
                assert.notCalled(buildClusterFactoryMock.create);
            });
        });

        it('returns 500 when the model encounters an error with an external cluster', () => {
            const testError = new Error('datastoreSaveError');

            buildClusterFactoryMock.create.rejects(testError);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 500);
            });
        });

        it('returns 500 when the model encounters an error with an internal cluster', () => {
            const testError = new Error('datastoreSaveError');

            options.payload = internalPayload;
            params = internalParams;
            buildClusterFactoryMock.create.rejects(testError);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('PUT /buildclusters/{name}', () => {
        let options;
        let updatedBuildClusterMock;
        let buildClusterMock;

        beforeEach(() => {
            buildClusterMock = getMockBuildClusters(testBuildCluster);
            options = {
                method: 'PUT',
                url: `/buildclusters/${name}`,
                payload: {
                    isActive: false,
                    description: 'updated description'
                },
                credentials
            };

            updatedBuildClusterMock = getMockBuildClusters(updatedBuildCluster);
            buildClusterFactoryMock.list.resolves(buildClusterMock);
            buildClusterMock.update.resolves(updatedBuildClusterMock);
            updatedBuildClusterMock.toJson.returns(updatedBuildCluster);
        });

        it('returns 200 and correct build cluster data', () =>
            server.inject(options).then((reply) => {
                assert.deepEqual(reply.result, updatedBuildCluster);
                assert.calledOnce(buildClusterMock.update);
                assert.equal(reply.statusCode, 200);
            })
        );

        it('returns 404 when the build cluster name is not found', () => {
            buildClusterFactoryMock.list.resolves(null);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 403 when the user does not have Screwdriver permissions', () => {
            screwdriverAdminDetailsMock.returns({ isAdmin: false });

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 403);
            });
        });

        it('returns 500 when the builClusterFactory fails to list', () => {
            const testError = new Error('builClusterFactoryGetError');

            buildClusterFactoryMock.list.rejects(testError);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 500);
            });
        });

        it('returns 500 when the build cluster model fails to update', () => {
            const testError = new Error('collectionModelUpdateError');

            buildClusterMock.update.rejects(testError);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('DELETE /buildclusters/{name}', () => {
        let options;
        let buildClusterMock;
        let userMock;

        beforeEach(() => {
            buildClusterMock = getMockBuildClusters(testBuildCluster);

            options = {
                method: 'DELETE',
                url: `/buildclusters/${name}`,
                credentials
            };
            userMock = {
                username,
                unsealToken: sinon.stub()
            };
            userFactoryMock.get.resolves(userMock);
            buildClusterFactoryMock.list.resolves(buildClusterMock);
            buildClusterMock.remove.resolves({});
        });

        it('returns 204 when delete is successful', () =>
            server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 204);
                assert.calledOnce(buildClusterMock.remove);
            })
        );

        it('returns 403 when user does not have permission', () => {
            screwdriverAdminDetailsMock.returns({ isAdmin: false });

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 403);
            });
        });

        it('returns 404 when build cluster does not exist', () => {
            buildClusterFactoryMock.list.resolves(null);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 404 when user does not exist', () => {
            userFactoryMock.get.withArgs({ username, scmContext }).resolves(null);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 500 when call returns error', () => {
            buildClusterMock.remove.rejects(new Error('collectionRemoveError'));

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });
});
