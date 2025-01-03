'use strict';

const urlLib = require('url');
const boom = require('@hapi/boom');
const validationSchema = require('screwdriver-data-schema');
const ANNOT_RESTRICT_PR = 'screwdriver.cd/restrictPR';
const { getScmUri, isStageTeardown } = require('../helper');
const { createEvent } = require('./helper/createEvent');

module.exports = () => ({
    method: 'POST',
    path: '/events',
    options: {
        description: 'Create and start a event',
        notes: 'Create and start a specific event',
        tags: ['api', 'events'],
        auth: {
            strategies: ['token'],
            scope: ['user', '!guest', 'pipeline']
        },

        handler: async (request, h) => {
            const { buildFactory, jobFactory, eventFactory, pipelineFactory, userFactory } = request.server.app;
            const { buildId, causeMessage, creator } = request.payload;
            const { scmContext, username, scope } = request.auth.credentials;
            const { scm } = eventFactory;
            const { isValidToken } = request.server.plugins.pipelines;
            const { updateAdmins } = request.server.plugins.events;

            let { pipelineId, startFrom, parentBuildId, parentBuilds, groupEventId, parentEventId, prNum } =
                request.payload;

            // Validation: Prevent event creation if startFrom is a stage teardown and parentEventID does not exist (start case)
            if (isStageTeardown(startFrom) && !parentEventId) {
                throw boom.badRequest('Event cannot be started from a stage teardown');
            }

            // restart case
            if (buildId) {
                const b = await buildFactory.get(buildId);
                const j = await jobFactory.get(b.jobId);

                ({ pipelineId, name: startFrom } = j);
                ({ parentBuildId, eventId: parentEventId } = b);

                if (b.parentBuilds) {
                    parentBuilds = b.parentBuilds;
                }

                if (b.eventId && !groupEventId) {
                    const parentEvent = await eventFactory.get(b.eventId);

                    groupEventId = parentEvent.groupEventId || b.eventId;
                }
            }

            const payload = {
                pipelineId,
                scmContext,
                startFrom,
                type: 'pipeline',
                username,
                meta: request.payload.meta // always exists because default is {}
            };

            if (parentEventId) {
                payload.parentEventId = parentEventId;
            }

            if (parentBuildId) {
                payload.parentBuildId = parentBuildId;
            }

            if (groupEventId) {
                payload.groupEventId = groupEventId;
            }

            if (parentBuilds) {
                payload.parentBuilds = parentBuilds;
            }

            if (causeMessage) {
                payload.causeMessage = causeMessage;
            }

            if (creator) {
                payload.creator = creator;
                if (creator.username !== 'sd:scheduler') {
                    payload.creator.username = username;
                }
            } else if (scope.includes('pipeline')) {
                payload.creator = {
                    name: 'Pipeline Access Token', // Display name
                    username
                };
            }

            // Check for startFrom
            if (!startFrom) {
                throw boom.badRequest('Missing "startFrom" field');
            }

            // Trigger "~pr" needs to have PR number given
            // Note: To kick start builds for all jobs under a PR,
            // you need both the prNum and the trigger "~pr" as startFrom
            if (startFrom.match(validationSchema.config.regex.PR_TRIGGER) && !prNum) {
                throw boom.badRequest('Trigger "~pr" must be accompanied by a PR number');
            }

            if (!prNum) {
                // If PR number isn't given, induce it from "startFrom"
                // Match PR-prNum, then extract prNum
                // e.g. if startFrom is "PR-1:main", prNumFullName will be "PR-1"; prNum will be "1"
                const prNumFullName = startFrom.match(validationSchema.config.regex.PR_JOB_NAME);

                prNum = prNumFullName ? prNumFullName[1].split('-')[1] : null;
            }

            // Fetch the pipeline and user models
            const [pipeline, user] = await Promise.all([
                pipelineFactory.get(pipelineId),
                userFactory.get({ username, scmContext })
            ]);

            if (!pipeline) {
                throw boom.notFound();
            } else if (pipeline.state === 'INACTIVE') {
                throw boom.badRequest('Cannot create an event for an inactive pipeline');
            }

            payload.scmContext = pipeline.scmContext;

            // In pipeline scope, check if the token is allowed to the pipeline
            if (!isValidToken(pipeline.id, request.auth.credentials)) {
                throw boom.unauthorized('Token does not have permission to this pipeline');
            }

            // Use parent's scmUri if pipeline is child pipeline and using read-only SCM
            const scmUri = await getScmUri({ pipeline, pipelineFactory });

            // Check the user's permission
            let permissions;

            try {
                permissions = await user.getPermissions(scmUri, pipeline.scmContext, pipeline.scmRepo);
            } catch (err) {
                if (err.statusCode === 403 && pipeline.scmRepo && pipeline.scmRepo.private) {
                    throw boom.notFound();
                }
                throw boom.boomify(err, { statusCode: err.statusCode });
            }

            // Update admins
            if (!prNum) {
                await updateAdmins({ permissions, pipeline, username });
            }

            // Get scmConfig
            const token = await user.unsealToken();
            const scmConfig = {
                prNum,
                scmContext: pipeline.scmContext,
                scmUri: pipeline.scmUri,
                scmRepo: pipeline.scmRepo,
                token
            };

            // Get and set PR data; update admins
            if (prNum) {
                payload.prNum = String(prNum);
                payload.type = 'pr';

                const [files, prInfo] = await Promise.all([
                    scm.getChangedFiles({
                        webhookConfig: null,
                        type: 'pr',
                        ...scmConfig
                    }),
                    scm.getPrInfo(scmConfig)
                ]).catch(err => {
                    throw boom.boomify(err, { statusCode: err.statusCode });
                });

                if (files && files.length) {
                    payload.changedFiles = files;
                }

                payload.prInfo = prInfo;
                payload.prRef = prInfo.ref;
                payload.prSource = prInfo.prSource;
                payload.chainPR = pipeline.chainPR;
                let restrictPR = 'none';

                if (pipeline.annotations && pipeline.annotations[ANNOT_RESTRICT_PR]) {
                    restrictPR = pipeline.annotations[ANNOT_RESTRICT_PR];
                }

                // PR author should be able to rerun their own PR build if restrictPR is not on
                if (restrictPR !== 'none' || prInfo.username !== username) {
                    // Remove user from admins
                    await updateAdmins({
                        permissions,
                        pipeline,
                        username
                    });
                }
            }

            let sha;

            try {
                // User has good permissions, create an event
                sha = await scm.getCommitSha(scmConfig);
            } catch (err) {
                if (err.statusCode) {
                    throw boom.boomify(err, { statusCode: err.statusCode });
                }
            }

            payload.sha = sha;

            // If there is parentEvent, pass workflowGraph, meta and sha to payload
            // Skip PR, for PR builds, we should always start from latest commit
            if (payload.parentEventId) {
                const parentEvent = await eventFactory.get(parentEventId);
                let mergedParameters = payload.meta.parameters || {};

                payload.baseBranch = parentEvent.baseBranch || null;

                // Merge parameters if they exist in the parent event and not in the payload
                if (!payload.meta.parameters && parentEvent.meta && parentEvent.meta.parameters) {
                    mergedParameters = parentEvent.meta.parameters;
                }
                delete payload.meta.parameters;

                // Copy meta from parent event if payload.meta is empty except for the parameters
                if (Object.keys(payload.meta).length === 0) {
                    payload.meta = { ...parentEvent.meta };
                }

                if (Object.keys(mergedParameters).length > 0) {
                    payload.meta.parameters = mergedParameters;
                }

                if (!prNum) {
                    payload.workflowGraph = parentEvent.workflowGraph;
                    payload.sha = parentEvent.sha;

                    if (parentEvent.configPipelineSha) {
                        payload.configPipelineSha = parentEvent.configPipelineSha;
                    }
                }
            }

            const event = await createEvent(payload, request.server);

            if (event.builds === null) {
                return boom.notFound('No jobs to start.');
            }

            // everything succeeded, inform the user
            const location = urlLib.format({
                host: request.headers.host,
                port: request.headers.port,
                protocol: request.server.info.protocol,
                pathname: `${request.path}/${event.id}`
            });

            return h.response(event.toJson()).header('Location', location).code(201);
        },
        validate: {
            payload: validationSchema.models.event.create
        }
    }
});
