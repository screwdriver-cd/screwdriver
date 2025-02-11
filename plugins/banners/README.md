# Banners Plugin
> API banners plugin for the Screwdriver API

## Usage

### Register plugin

```javascript
const Hapi = require('@hapi/hapi');
const server = new Hapi.Server();
const bannersPlugin = require('./');

server.connection({ port: 3000 });

server.register({
    register: bannersPlugin,
    options: {}
}, () => {
    server.start((err) => {
        if (err) {
            throw err;
        }
        console.log('Server running at:', server.info.uri);
    });
});
```

### Routes

#### Create a banner

`POST /banners`

**Arguments**

* `message` - Text of the banner to create.
* `type` - An optional banner type. Options are `info` and `warn`. Defaults to `info`
* `isActive` - An optional status flag to indicate whether banner should display.  Defaults to `false`
* `scope` - An optional scope type that specifies whether the banner should be displayed globally or limited to the affected pipelines or builds. Accepted values are `GLOBAL`, `PIPELINE`, and `BUILD`, with `GLOBAL` as the default.
* `scopeId` - A required field when the scope is set to `PIPELINE` or `BUILD`, serving as a reference to the corresponding pipeline or build ID.

Example payload:
```json
{
    "message": "The Screwdriver Team is currently investigating random failures.",
    "type": "info",
    "isActive": "true",
    "scope": "PIPELINE",
    "scopeId": "12345"
}
```

#### Get a listing of all banners

Query Params:

* `scope` - *Optional* Returns banners for a specific scope
* `scopeId` - *Optional* Filters by a specific scope ID
* `createdBy` - *Optional* Filters banners created by a specific user
* `type` - *Optional* Filters by banner type
* `isActive` - *Optional* Accepts true or false to filter active or inactive banners

`GET /banners?scope=GLOBAL&isActive=true&type=info`

`GET /banners?scope=PIPELINE&scopeId=12345&isActive=true&type=info`


#### Get a specific banner

`GET /banners/{id}`

#### Update a specific banner

`PUT /banners/{id}`

**Arguments**

* `message` - An optional new string of text for the banner.
* `type` - An optional new banner type. Options are `info` and `warn`
* `isActive` - An optional new status flag to indicate whether banner should display.

Example payload:
```json
{
    "message": "The Screwdriver Team has resolved the random failure issue.",
    "type": "info",
    "isActive": "true"
}
```

#### Delete a specific banner

`DELETE /banners/{id}`
