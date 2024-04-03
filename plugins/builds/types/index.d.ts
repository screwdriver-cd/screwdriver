import {BuildModel, EventModel, PipelineModel, StageModel} from './models.js';
import {BuildFactory, PipelineFactory, EventFactory, StageBuildFactory, StageFactory, JobFactory, BannerFactory, TriggerFactory} from 'screwdriver-models';

// -----------------------------------------------------------------------------
//      Build API Plugin Server
// -----------------------------------------------------------------------------
/**
 * The assigned arguments of hapi servers expose function
 * @property {PipelineModel}        pipeline        Pipeline to which the current build belongs
 * @property {JoinJob}              job             Job to which the current build belongs
 * @property {BuildModel}           build           Build to which the current build belongs
 * @property {number}               username        Triggered username
 * @property {string}               scmContext      e.g., 'github:github.com'
 * @property {EventModel}           event           Event to which the current build belongs
 * @property {StageModel | null}    event           Stage to which the current build belongs
 */
export type ServerConfig = {
    pipeline: PipelineModel;
    job: JoinJob;
    build: BuildModel;
    username: number;
    scmContext: string;
    event: EventModel;
    stage: StageModel | null;
};

/**
 * The assigned arguments of hapi servers expose function
 * @property {BuildFactory}         buildFactory        Instance of BuildFactory
 * @property {PipelineFactory}      pipelineFactory     Instance of PipelineFactory
 * @property {EventFactory}         eventFactory        Instance of EventFactory
 * @property {StageBuildFactory}    stageBuildFactory   Instance of StageBuildFactory
 * @property {StageFactory}         stageFactory        Instance of StageFactory
 * @property {JobFactory}           jobFactory          Instance of JobFactory
 * @property {BannerFactory}        bannerFactory       Instance of BannerFactory
 * @property {TriggerFactory}       triggerFactory      Instance of TriggerFactory
 */
export type ServerApp = {
    buildFactory: BuildFactory;
    pipelineFactory: PipelineFactory;
    eventFactory: EventFactory;
    stageBuildFactory: StageBuildFactory;
    stageFactory: StageFactory;
    jobFactory: JobFactory;
    bannerFactory: BannerFactory;
    triggerFactory: TriggerFactory;
};

// -----------------------------------------------------------------------------
//      JoinPipelines
// -----------------------------------------------------------------------------
/**
 * Next job information object
 * (JoinPipelines is used in 'createJoinObject' in 'helper.js')
 *
 * {string}   Object.Key    Pipeline ID
 * {JoinJobs} Object.Value  Joined next job information
 *
 * @example
 * {
 *  '1': {
 *      jobs: {
 *          build: {
 *              id: 13
 *              join: [
 *                  {
 *                      name: publish;
 *                      id: 5;
 *                  },
 *                  {
 *                      name: sd@3:remote;
 *                      id: 8;
 *                  }
 *              ],
 *              isExternal: false;
 *          }
 *      },
 *      event: {
 *          groupEventId: 1,
 *          pipelineId: 1,
 *          startFrom: 'hub',
 *          id: 1,
 *          pr: object
 *          meta: object
 *      }
 *  },
 *  '3': {
 *      jobs: {
 *          remote: {
 *              id: 8,
 *              join: [],
 *              isExternal: true;
 *          }
 *      }
 *  }
 */
export type JoinPipelines = Record<string, JoinJobs>;

/**
 * Joined job information
 * @property {Record<string, JoinJob>} jobs     Next jobs
 * @property {EventModel | undefined}  event    Next external event
 */
type JoinJobs = {
    jobs: Record<string, JoinJob>;
    event: EventModel | undefined;
};

/**
 * Joined job information object
 * @property {string}      id           Job ID
 * @property {Array<Join>} join         Next triggered jobs
 * @property {boolean}     isExternal   External trigger flag
 */
export type JoinJob = {
    id: string;
    join: Array<Join>;
    isExternal: boolean;
};

/**
 * Joined job name and ID object
 * @property {string} name  Job name
 * @property {string} id    Job ID
 */
export type Join = {
    name: string;
    id: number;
};

// -----------------------------------------------------------------------------
//      JobInfo
// -----------------------------------------------------------------------------
/**
 * JobInfo is used in 'parseJobInfo' in 'helper.js'
 * @property {Record<string, ParentBuild>} parentBuilds
 * @property {Array<string>} joinListNames
 * @property {Record<string, { eventId: object, jobs: Record<string, object>}} joinParentBuilds
 */
export type JobInfo = {
    parentBuilds: Record<string, ParentBuild>,
    joinListNames: Array<string>,
    joinParentBuilds: Record<string, ParentBuild>,
}

/**
 * Parent Build information object
 * @property {number} eventId                       Parent build event ID
 * @property {Record<string, number | null>} jobs   Parent Job Name (Key) and Job ID (Value)
 */
export type ParentBuild = {
    eventId: number;
    jobs: Record<string | null, number | null>,
}
