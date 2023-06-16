'use strict';

const { assert } = require('chai');
const sinon = require('sinon');
const hapi = require('@hapi/hapi');
const urlLib = require('url');
const hoek = require('@hapi/hoek');
const testBuildCluster = require('./data/buildCluster.json');
const testBuildClusters = require('./data/buildClusters.json');
const updatedBuildCluster = require('./data/updatedBuildCluster.json');

sinon.assert.expose(assert, { prefix: '' });

const decorateBuildClusterObject = buildCluster => {
    const decorated = hoek.clone(buildCluster);

    decorated.update = sinon.stub().resolves(updatedBuildCluster);
    decorated.remove = sinon.stub().resolves({});
    decorated.toJson = sinon.stub().returns(buildCluster);

    return decorated;
};

const getMockBuildClusters = buildClusters => {
    if (Array.isArray(buildClusters)) {
        return buildClusters.map(decorateBuildClusterObject);
    }

    return decorateBuildClusterObject(buildClusters);
};

describe('buildCluster plugin test', () => {
    const username = 'myself';
    const scmUserId = 123;
    const scmContext = 'github:github.com';
    const scmDisplayName = 'github';
    const buildClusterId = 12345;
    const name = 'iOS';
    const credentials = {
        scope: ['user'],
        scmUserId,
        username,
        scmContext
    };

    let buildClusterFactoryMock;
    let bannerFactoryMock;
    let userFactoryMock;
    let bannerMock;
    let screwdriverAdminDetailsMock;
    let authMock;
    let plugin;
    let server;

    beforeEach(async () => {
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
        bannerFactoryMock = {
            scm: {
                getDisplayName: sinon.stub()
            }
        };
        screwdriverAdminDetailsMock = sinon.stub().returns({ isAdmin: true });

        /* eslint-disable global-require */
        plugin = require('../../plugins/buildClusters');
        /* eslint-enable global-require */
        server = new hapi.Server({
            port: 12345,
            host: 'localhost'
        });
        server.app = {
            buildClusterFactory: buildClusterFactoryMock,
            userFactory: userFactoryMock,
            bannerFactory: bannerFactoryMock
        };
        server.auth.scheme('custom', () => ({
            authenticate: (_, h) =>
                h.authenticated({
                    credentials: {
                        scope: ['user']
                    }
                })
        }));
        server.auth.strategy('token', 'custom');
        server.auth.strategy('session', 'custom');

        bannerMock = {
            name: 'banners',
            register: s => {
                s.expose('screwdriverAdminDetails', screwdriverAdminDetailsMock);
            }
        };
        authMock = {
            name: 'auth',
            register: () => {}
        };

        await server.register([
            { plugin: bannerMock },
            { plugin: authMock },
            {
                plugin,
                options: {
                    authConfig: {
                        jwtPrivateKey: 'boo'
                    }
                }
            },
            {
                // eslint-disable-next-line global-require
                plugin: require('../../plugins/pipelines')
            }
        ]);
    });

    afterEach(() => {
        server.stop();
        server = null;
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
                auth: {
                    credentials,
                    strategy: ['token']
                }
            };
        });

        it('returns 200 and all build clusters', () => {
            buildClusterFactoryMock.list.resolves(getMockBuildClusters(testBuildClusters));

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testBuildClusters);
            });
        });

        it('returns 500 when datastore fails', () => {
            buildClusterFactoryMock.list.rejects(new Error('fail'));

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('GET /buildclusters/{name}', () => {
        it('returns 200 for a build cluster that exists', () => {
            buildClusterFactoryMock.list
                .withArgs({ params: { name } })
                .resolves(getMockBuildClusters(testBuildClusters));

            return server.inject(`/buildclusters/${name}`).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testBuildCluster);
            });
        });

        it('returns 404 when build cluster does not exist', () => {
            buildClusterFactoryMock.list.withArgs({ params: { name } }).resolves([]);

            return server.inject(`/buildclusters/${name}`).then(reply => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 500 when datastore returns an error', () => {
            buildClusterFactoryMock.list.withArgs({ params: { name } }).rejects(new Error('blah'));

            return server.inject(`/buildclusters/${name}`).then(reply => {
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
            weightage: 20,
            group: 'default'
        };
        const internalParams = {
            name: 'k8s',
            description: 'Screwdriver build cluster using k8s',
            scmOrganizations: ['screwdriver-cd'],
            isActive: true,
            managedByScrewdriver: true,
            maintainer: 'foo@bar.com',
            weightage: 20,
            scmContext,
            group: 'default'
        };
        let params = {
            name: 'iOS',
            description: 'Build cluster for iOS team',
            scmOrganizations: ['screwdriver-cd'],
            isActive: true,
            managedByScrewdriver: false,
            maintainer: 'foo@bar.com',
            weightage: 50,
            scmContext,
            group: 'default'
        };

        let options;
        let userMock;
        let buildClusterMock;

        beforeEach(() => {
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
                auth: {
                    credentials,
                    strategy: ['token']
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
            userFactoryMock.get.resolves(userMock);
            bannerFactoryMock.scm.getDisplayName.withArgs({ scmContext }).returns(scmDisplayName);
        });

        it('returns 201 for a successful create for an external build cluster', () => {
            let expectedLocation;

            return server.inject(options).then(reply => {
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
                assert.strictEqual(reply.headers.location, urlLib.format(expectedLocation));
                assert.calledWith(buildClusterFactoryMock.create, params);
            });
        });

        it('returns 201 for a successful create for an internal build cluster', () => {
            let expectedLocation;

            options.payload = internalPayload;
            params = internalParams;

            return server.inject(options).then(reply => {
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
                assert.strictEqual(reply.headers.location, urlLib.format(expectedLocation));
                assert.calledWith(buildClusterFactoryMock.create, params);
            });
        });

        it('returns 422 when the no scm orgs provided for an external cluster', () => {
            options.payload.scmOrganizations = [];

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 422);
                assert.notCalled(buildClusterFactoryMock.create);
            });
        });

        it('returns 403 when the user is not a Screwdriver admin for an internal cluster', () => {
            options.payload = internalPayload;
            params = internalParams;
            screwdriverAdminDetailsMock.returns({ isAdmin: false });

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 403);
                assert.notCalled(buildClusterFactoryMock.create);
            });
        });

        it('returns 500 when the model encounters an error with an external cluster', () => {
            const testError = new Error('datastoreSaveError');

            buildClusterFactoryMock.create.rejects(testError);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });

        it('returns 500 when the model encounters an error with an internal cluster', () => {
            const testError = new Error('datastoreSaveError');

            options.payload = internalPayload;
            params = internalParams;
            buildClusterFactoryMock.create.rejects(testError);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('PUT /buildclusters/{name}', () => {
        let options;
        let updatedBuildClusterMock;
        let buildClustersMock;

        beforeEach(() => {
            buildClustersMock = getMockBuildClusters(testBuildClusters);
            options = {
                method: 'PUT',
                url: `/buildclusters/${name}`,
                payload: {
                    isActive: false,
                    description: 'updated description'
                },
                auth: {
                    credentials,
                    strategy: ['token']
                }
            };

            updatedBuildClusterMock = getMockBuildClusters(updatedBuildCluster);
            buildClusterFactoryMock.list.resolves(buildClustersMock);
            buildClustersMock[0].update.resolves(updatedBuildClusterMock);
            updatedBuildClusterMock.toJson.returns(updatedBuildCluster);
            buildClusterFactoryMock.scm.getOrgPermissions.resolves({
                admin: true,
                member: true
            });
            bannerFactoryMock.scm.getDisplayName.withArgs({ scmContext }).returns(scmDisplayName);
        });

        it('returns 200 and correct build cluster data', () =>
            server.inject(options).then(reply => {
                assert.deepEqual(reply.result, updatedBuildCluster);
                assert.calledOnce(buildClustersMock[0].update);
                assert.equal(reply.statusCode, 200);
            }));

        it('returns 200 when update managedByScrewdriver with cluster admin permissions', () => {
            options.payload.managedByScrewdriver = true;

            return server.inject(options).then(reply => {
                assert.deepEqual(reply.result, updatedBuildCluster);
                assert.calledOnce(buildClustersMock[0].update);
                assert.equal(reply.statusCode, 200);
            });
        });

        it('returns 404 when the build cluster name is not found for internal cluster', () => {
            options.payload.managedByScrewdriver = true;
            buildClusterFactoryMock.list.resolves([]);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 404 when the build cluster name is not found', () => {
            buildClusterFactoryMock.list.resolves([]);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 403 when update managedByScrewdriver without cluster admin permissions', () => {
            screwdriverAdminDetailsMock.returns({ isAdmin: false });
            options.payload.managedByScrewdriver = true;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 403);
            });
        });

        it('returns 422 when build cluster returns non-array for external cluster', () => {
            buildClusterFactoryMock.list.resolves({});

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 422);
            });
        });

        it('returns 422 when the no scm orgs provided for an external cluster', () => {
            options.payload.scmOrganizations = [];

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 422);
                assert.notCalled(buildClusterFactoryMock.create);
            });
        });

        it('returns 500 when the builClusterFactory fails to list', () => {
            const testError = new Error('builClusterFactoryGetError');

            buildClusterFactoryMock.list.rejects(testError);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });

        it('returns 500 when the build cluster model fails to update', () => {
            const testError = new Error('collectionModelUpdateError');

            buildClustersMock[0].update.rejects(testError);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('DELETE /buildclusters/{name}', () => {
        let options;
        let buildClustersMock;
        let userMock;

        beforeEach(() => {
            buildClustersMock = getMockBuildClusters(testBuildClusters);

            options = {
                method: 'DELETE',
                url: `/buildclusters/${name}`,
                auth: {
                    credentials,
                    strategy: ['token']
                }
            };
            userMock = {
                username,
                unsealToken: sinon.stub()
            };
            userFactoryMock.get.resolves(userMock);
            buildClusterFactoryMock.list.resolves(buildClustersMock);
            buildClustersMock[0].remove.resolves({});
            bannerFactoryMock.scm.getDisplayName.withArgs({ scmContext }).returns(scmDisplayName);
        });

        it('returns 204 when delete is successful', () =>
            server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 204);
                assert.calledOnce(buildClustersMock[0].remove);
            }));

        it('returns 403 when user does not have permission', () => {
            screwdriverAdminDetailsMock.returns({ isAdmin: false });

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 403);
            });
        });

        it('returns 404 when build cluster does not exist', () => {
            buildClusterFactoryMock.list.resolves([]);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 404 when user does not exist', () => {
            userFactoryMock.get.withArgs({ username, scmContext }).resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 500 when call returns error', () => {
            buildClustersMock[0].remove.rejects(new Error('collectionRemoveError'));

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });
});
