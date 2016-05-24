# Screwdriver API
[![Version][npm-image]][npm-url] ![Downloads][downloads-image] [![Build Status][wercker-image]][wercker-url] [![Open Issues][issues-image]][issues-url] [![Dependency Status][daviddm-image]][daviddm-url] ![License][license-image]

> API module for the Screwdriver CD service

## Usage

```bash
npm install screwdriver-api
```

To start the server:
```bash
npm start
```

The server now exposes the following route(s):
```
http://localhost:8666/v3/status
```

## Testing
### Running unit tests:
```bash
npm test
```

### Running functional tests:
Start the server first by running:
```bash
npm start
```

On a different terminal, run functional tests:
```bash
INSTANCE="http://localhost:8666" TEST_DIR="./artifacts" npm run functional
```

## License

Code licensed under the BSD 3-Clause license. See LICENSE file for terms.

[npm-image]: https://img.shields.io/npm/v/screwdriver-api.svg
[npm-url]: https://npmjs.org/package/screwdriver-api
[downloads-image]: https://img.shields.io/npm/dt/screwdriver-api.svg
[license-image]: https://img.shields.io/npm/l/screwdriver-api.svg
[issues-image]: https://img.shields.io/github/issues/screwdriver-cd/screwdriver-api.svg
[issues-url]: https://github.com/screwdriver-cd/screwdriver-api/issues
[wercker-image]: https://app.wercker.com/status/3b34e93cc47c1b05d484158c012cb731
[wercker-url]: https://app.wercker.com/project/bykey/3b34e93cc47c1b05d484158c012cb731
[daviddm-image]: https://david-dm.org/screwdriver-cd/screwdriver-api.svg?theme=shields.io
[daviddm-url]: https://david-dm.org/screwdriver-cd/screwdriver-api
