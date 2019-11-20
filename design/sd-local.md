## Context
The build environment on Screwdriver.cd differs from the user execution environment in the following ways:
- `sd-step` is available
- Template is available
- Metadata is available
- Environment Variables are idempotent
- OS in Build Container is used

Therefore, the build results may differ between the build environment on local and the build environment on Screwdriver.cd.
As a result, User cannot confirm whether the result obtained on CI is the expected result until the build is actually run on Screwdriver.cd.

## Proposal

Provide the function for users to run builds locally.

A simple example is shown below

```
$ cat screwdriver.yaml
jobs:
  test:
    image: centos7:latest
    steps:
      - echo: echo "test"
$ sdlocal build test # start `test` job in screwdriver.yaml
echo "test"
test
```

## Details

![image](./diagrams/sd-local-flow.puml.png)


### Initialization

1. Run `sdlocal build` command
2. Get JWT from API
3. Validate screwdriver.yaml
   - Validate yaml
   - Get Template/Step information
4. Pull Launcher Image from Docker Hub
5. Copy the binaries under `/opt/sd/` from Launcher Container to the common volume
6. Pull Build Image from Docker Hub

### Run Build
1. Mount the following and run Build Container
   - SSH-Agent Socket
   - The common volume prepared in `Initialization` No.4
   - Source Directory
   - Artifacts Directory
2. Run `run.sh` on Build Container
   - Run Steps got in `Initialization` No.3
   - Run `sd-cmd`
     1. Get the binaries from Store
     2. Run it
3. Write Artifacts to Artifacts Directory
4. Output logs to stdout

### Build Environment Variables

- SD_BUILD_ID: Not set
- SD_EVENT_ID: Not set
- SD_JOB_ID: Not set
- SD_JOB_NAME: The value passed as a argument
- SD_PARENT_BUILD_ID: Not set
- SD_PARENT_EVENT_ID: Not set
- SD_PR_PARENT_JOB_ID: Not set
- SD_PIPELINE_ID: Not set
- SD_PIPELINE_NAME: Not set
- SD_PULL_REQUEST: Not set
- SD_TEMPLATE_FULLNAME: The value got from validator API
- SD_TEMPLATE_NAME: The value got from validator API
- SD_TEMPLATE_NAMESPACE: The value got from validator API
- SD_TEMPLATE_VERSION: The value got from validator API
- SD_TOKEN: JWT got in `Initialization`
- SD_ZIP_ARTIFACTS: Not set
- USER_SHELL_BIN: Set by user, otherwise Screwdriver.cd default
- GIT_SHALLOW_CLONE: Set by user, otherwise Screwdriver.cd default
- GIT_SHALLOW_CLONE_DEPTH: Set by user, otherwise Screwdriver.cd default
- GIT_SHALLOW_CLONE_SINCE: Set by user, otherwise Screwdriver.cd default
- GIT_SHALLOW_CLONE_SINGLE_BRANCH: Set by user, otherwise Screwdriver.cd default
- SD_COVERAGE_PLUGIN_ENABLED: Set by user, otherwise Screwdriver.cd default
- SD_SONAR_AUTH_URL: Not set
- SD_SONAR_HOST: Not set
- SD_ARTIFACTS_DIR: `/sd/workspace/artifacts`
- SD_META_PATH: `/sd/meta/meta.json`
- SD_ROOT_DIR: `/sd/workspace`
- SD_SOURCE_DIR: `/sd/workspace/src/<SCM hostname>/<organization>/<repository>`
- SD_SOURCE_PATH: Generate from `screwdriver.yaml`
- SD_CONFIG_DIR: Not set (Need to be set to support External Config)
- SCM_URL: Not set
- GIT_URL: Not set
- CONFIG_URL: Not set (Need to be set to support External Config)
- GIT_BRANCH: Not set
- SD_BUILD_SHA: Not set
- SD_API_URL: The value got from Configuration File
- SD_BUILD_URL: Not set
- SD_STORE_URL: The value got from Configuration File
- SD_UI_URL: Not set
- CI: `false`
- CONTINUOUS_INTEGRATION: `false`
- SCREWDRIVER: `false`


## Usage

### Prerequisites
- Docker runtime

### Start build

```bash
$ sdlocal build [job-name] [options]
```

#### Input

- `job-name` the job in `screwdriver.yaml` to be run locally (default: `./screwdriver.yaml`)

##### Options

- `--meta [json]` Set values of `meta` (JSON)
- `--meta-file [path]` Path to config file of `meta` (JSON)
- `-e, --env [key=value]` Set `key` and `value` relationship which is set as environment variables of Build Container.
  - `secrets` is also set as the environment variables.
- `--env-file [path]` Path to config file of environment variables. (`.env`)
- `--artifacts-dir [path]` Path to the host side directory which is mounted into `$SD_ARTIFACTS_DIR`. (default: `./sd-artifacts`)
- `-m, --memory [size]` Set memory size which Build Container can use. Either b, k, m, g can be used as a size unit. (default: ?)
- `-o --output [path]` Path to file name where the logs are output. (default: stdout)
- `--src-url [repository url]` Set repository URL which is to build when user use the remote repository without local files.

#### Output

- Logs of all executed steps in the job.
- Artifacts which is output to `$SD_ARTIFACTS_DIR`.

### Configuration

```bash
$ sdlocal config set [key] [value]
```

The chart below shows relationship between `key` and `value`.

|key|value|
|:-:|:-:|
|api-url|Screwdriver API URL|
|store-url|Screwdriver Store URL|
|token|Screwdriver API token|
|launcher-version|Version of Launcher Image (default: stable)|
|launcher-image|Name of Launcher Image (default: screwdrivercd/launcher)|

Create config file as `$HOME/.sdlocal/config` with YAML format.

```yaml
api-url: <Screwdriver API URL>
store-url: <Screwdriver Store URL>
token: <Screwdriver API Token>
launcher:
  version: <Launcher Version>
  image: <Launcher image name>
```

Can confirm setting configurations with the command below:

```bash
$ sdlocal config view
```

#### Options

- `--local` Run command with `.sdlocal/config` file in current directory.

## Design considerations

- APIs which is needed to call from Launcher.
  - build API
    - For getting informations of each steps or the other.
      - This may be obtained from the `commands` which is included an JSON response of validator API.
- Screwdriver has to recognize `run.sh` is executed from the `sdlocal` command.
- Build logs which are output to the `log-service` must be changed to stdout.
- `publish`/`promote` of any `sd-cmd` must not be executed from the `sdlocal` command.

- Not support feature in the first step.
  - `docker build` from the `sdlocal` command. (It may possible if using `privileged`)
  - Entering into docker container for debugging.
    - It is possible if we add `sleep` command in the teardown step, and enter the container with `exec` command during that time.
    - We can enter the container only by restarting the container which has finished the build. It is not good for user to restart the same build.

