'use strict';

const { LollipopPlatform } = require('./platform');
const PLATFORM_NAME = 'LollipopCamera';

module.exports = (api) => {
  api.registerPlatform(PLATFORM_NAME, LollipopPlatform);
};
