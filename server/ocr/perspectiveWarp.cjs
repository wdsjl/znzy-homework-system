const PerspT = require('perspective-transform');
const { markersToSrcArray, canonicalDstArray } = require('./markerDetect.cjs');

const OUT_WIDTH = 1240;
const OUT_HEIGHT = 1754;

function sampleBilinear(data, width, height, channels, x, y) {
  if (x < 0 || y < 0 || x >= width - 1 || y >= height - 1) return null;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const dx = x - x0;
  const dy = y - y0;
  const out = new Array(channels).fill(0);

  for (let c = 0; c < channels; c += 1) {
    const v00 = data[(y0 * width + x0) * channels + c];
    const v10 = data[(y0 * width + x1) * channels + c];
    const v01 = data[(y1 * width + x0) * channels + c];
    const v11 = data[(y1 * width + x1) * channels + c];
    out[c] = Math.round(
      v00 * (1 - dx) * (1 - dy)
      + v10 * dx * (1 - dy)
      + v01 * (1 - dx) * dy
      + v11 * dx * dy
    );
  }
  return out;
}

function warpRawBuffer({ data, width, height, channels }, srcPoints, dstPoints) {
  const transform = PerspT(srcPoints, dstPoints);
  const out = Buffer.alloc(OUT_WIDTH * OUT_HEIGHT * channels);

  for (let y = 0; y < OUT_HEIGHT; y += 1) {
    for (let x = 0; x < OUT_WIDTH; x += 1) {
      const [srcX, srcY] = transform.transformInverse(x, y);
      const sampled = sampleBilinear(data, width, height, channels, srcX, srcY);
      const outIdx = (y * OUT_WIDTH + x) * channels;
      if (!sampled) {
        for (let c = 0; c < channels; c += 1) out[outIdx + c] = 255;
        continue;
      }
      for (let c = 0; c < channels; c += 1) out[outIdx + c] = sampled[c];
    }
  }

  return { data: out, width: OUT_WIDTH, height: OUT_HEIGHT, channels };
}

function buildDstPoints() {
  return canonicalDstArray(OUT_WIDTH, OUT_HEIGHT);
}

function buildSrcPoints(markerPoints) {
  return markersToSrcArray(markerPoints);
}

module.exports = {
  warpRawBuffer,
  buildDstPoints,
  buildSrcPoints,
  OUT_WIDTH,
  OUT_HEIGHT,
};
