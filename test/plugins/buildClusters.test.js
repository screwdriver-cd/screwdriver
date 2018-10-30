'use strict';

const { assert } = require('chai');
const sinon = require('sinon');
const hapi = require('hapi');
const mockery = require('mockery');
const urlLib = require('url');
const hoek = require('hoek');

sinon.assert.expose(assert, { prefix: '' });

const decorateBuildClusterObject = (buildCluster) => {
    const decorated = hoek.clone(buildCluster);

    decorated.update = sinon.stub();
    decorated.toJson = sinon.stub().returns(buildCluster);

    return decorated;
};

const getMockBuildClusters = (buildClusters) => {
    if (Array.isArray(buildClusters)) {
        return buildClusters.map(decorateBuildClusterObject);
    }

    return decorateBuildClusterObject(buildClusters);
};

describe.only('buildCluster plugin test', () => {
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
            get: sinon.stub(),
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

    describe('POST /buildclusters', () => {
        const username = 'myself';
        const scmContext = 'github:github.com';
        const buildClusterId = 12345;
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
                credentials: {
                    scope: ['user'],
                    username,
                    scmContext
                }
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
});
