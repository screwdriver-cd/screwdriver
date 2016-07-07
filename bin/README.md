## Usage

The `server` script is used to start the API service, overriding plugin configuration that is required.

## Running locally

To start the service, a few environment variables need to be set:

### Required Environment Variables
#### `screwdriver-plugin-login`
| Environment Variable        |  Description           |
| :------------- |:-------------|
| $SECRET_JWT_PRIVATE_KEY| A private key uses for signing jwt tokens. Can be anything |
| $SECRET_OAUTH_CLIENT_ID | The client id used for OAuth with github. Look up [GitHub OAuth] for details |
| $SECRET_OAUTH_CLIENT_SECRET | The client secret used for OAuth with github |
| $SECRET_PASSWORD | A password used for encrypting session, and OAuth data. **Needs to be minimum 32 characters** |
| $IS_HTTPS | A flag to set if the server is running over https. Used as a flag for the OAuth flow |

### Optional Environment Variables
#### `screwdriver-executor-k8s`
To customize the Kubernetes cluster used by the executor.


| Environment Variable        |  Description           | Default Value |
| :------------- |:-------------|:-------------|
| $K8S_HOST | The host or IP of the kubernetes cluster i.e. 50.232.14.51 | `kubernetes` |
| $K8S_TOKEN | The jwt token used for authenticating https requests. | Contents of file `/etc/kubernetes/apikey/token` |
**Note: The defaults assume that the API is running inside kubernetes.**


[GitHub OAuth]: https://developer.github.com/v3/oauth/
