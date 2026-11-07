'use strict';
// InnerTube transport for regular YouTube (YouTube mode). Same scaffolding as
// the music transport, but the WEB client on the https://www.youtube.com
// origin: SAPISIDHASH and X-Origin must use this origin or signed-in
// requests silently 401 (see Kaset for macOS, docs/youtube.md).
const { createTransport } = require('./innertube');

module.exports = createTransport({
  origin: 'https://www.youtube.com',
  clientName: 'WEB',
  clientNameId: 1,
  clientVersion: '2.20260611.01.00',
  label: 'YouTube',
});
