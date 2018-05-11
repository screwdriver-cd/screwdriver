# Banners Plugin
> API banners plugin for the Screwdriver API

## Usage

### Register plugin

```javascript
const Hapi = require('hapi');
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
* `type` - An optional banner type. Defaults to `info`
* `isActive` - An optional status flag to indicate whether banner should display.  Defaults to `false`

Example payload:
```json
{
    "message": "The Screwdriver Team is currently investigating random failures.",
    "type": "info",
    "isActive": "true"
}
```

#### Get a listing of all banners

`GET /banners`

#### Get a specific banner

`GET /banners/{id}`

#### Update a specific banner

`PUT /banners/{id}`

**Arguments**

* `message` - An optional new string of text for the banner.
* `type` - An optional new banner type. 
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
