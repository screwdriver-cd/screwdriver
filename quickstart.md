# Quickstart: Setting up the API Locally for Development

This document should help you get a local copy of the Screwdriver API running, using Kubernetes as the executor and GitHub as the SCM.

For more details, see the [readme](https://github.com/screwdriver-cd/screwdriver#screwdriver-api).

## Prerequisites
- Node v6.0.0 or higher
- [kubectl](https://kubernetes.io/docs/tasks/kubectl/install/)

### Creating a GitHub Application

First go to [GitHub's OAuth page](https://github.com/settings/developers) and register a new application.

Set the Homepage URL to `http://localhost:8080` and the Authorization Callback URL to `http://localhost:8080/v4/auth/login`.

### Installing the API

```bash
$ git clone git@github.com:screwdriver-cd/screwdriver.git ./
$ npm install
$ vim ./config/local.yaml # See below for configuration
```

#### Configuration

Create the file `config/local.yaml`, and set the following:

```yaml
auth:
    # A private key used for signing jwt tokens
    # Easily generate one by running
    # $ openssl genrsa -out jwt.pem 2048
    jwtPrivateKey: PRIVATE_KEY_HERE

    # The public key used for verifying the signature
    # Generate one by running
    # $ openssl rsa -in jwt.pem -pubout -out jwt.pub
    jwtPublicKey: PUBLIC_KEY_HERE

httpd:
    # Port to listen on
    # You can leave this as a default,
    # but if you do you'll need to run the server with sudo
    port: 8080
    # Host to listen on (set to localhost to only accept connections from this machine)
    host: 0.0.0.0
    # Externally routable URI (usually your load balancer or CNAME)
    uri: http://localhost:8080

scm:
    plugin: github
    github:
        # The client id used for OAuth with github. Look up GitHub OAuth for details
        # https://developer.github.com/v3/oauth/
        oauthClientId: CLIENT_ID_HERE
        # The client secret used for OAuth with github
        oauthClientSecret: CLIENT_SECRET_HERE

ecosystem:
    # Externally routable URL for the User Interface
    # If you build a local copy of the ui it will run on localhost:4200
    ui: http://localhost:4200
```

```bash
$ npm start
info: Server running at http://localhost:8080
```

The API is now ready to go, and will work with a local copy of the [Screwdriver UI](https://github.com/screwdriver-cd/ui#screwdriver-ui).
