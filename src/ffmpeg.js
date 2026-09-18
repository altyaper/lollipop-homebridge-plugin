'use strict';

const fs = require('fs');
const path = require('path');
const bundledFfmpegPath = require('ffmpeg-for-homebridge');

function isExecutable(candidate) {
  try {
    if (!fs.statSync(candidate).isFile()) return false;
    fs.accessSync(candidate, fs.constants.X_OK);
    return true;
  } catch (_) {
    return false;
  }
}

function selectFfmpegPath({
  explicitPath,
  bundledPath,
  pathValue,
  isExecutable: canExecute = isExecutable,
}) {
  if (explicitPath && canExecute(explicitPath)) return explicitPath;
  if (bundledPath && canExecute(bundledPath)) return bundledPath;

  for (const directory of (pathValue || '').split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(directory, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
    if (canExecute(candidate)) return candidate;
  }

  throw new Error('No usable FFmpeg executable found. Install FFmpeg or set FFMPEG_PATH to an executable file.');
}

function getFfmpegPath() {
  return selectFfmpegPath({
    explicitPath: process.env.FFMPEG_PATH,
    bundledPath: bundledFfmpegPath,
    pathValue: process.env.PATH,
  });
}

module.exports = { getFfmpegPath, selectFfmpegPath };
