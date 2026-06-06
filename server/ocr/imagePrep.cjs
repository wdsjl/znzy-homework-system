const path = require('path');
const sharp = require('sharp');
const { detectMarkersFromRaw } = require('./markerDetect.cjs');
const { warpRawBuffer, buildDstPoints, buildSrcPoints, OUT_WIDTH, OUT_HEIGHT } = require('./perspectiveWarp.cjs');

async function prepareAnswerSheetImage(inputPath, outputDir) {
  const rotated = await sharp(inputPath).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { data, info } = rotated;
  const frame = { data, width: info.width, height: info.height, channels: info.channels };
  const markerResult = detectMarkersFromRaw(frame);
  const dstPoints = buildDstPoints();
  const srcPoints = buildSrcPoints(markerResult.points);

  let working = frame;
  const preprocessing = ['exif-rotate'];

  if (markerResult.reliable) {
    working = warpRawBuffer(frame, srcPoints, dstPoints);
    preprocessing.push(markerResult.highConfidence ? 'marker-detect' : 'marker-estimate', 'perspective-warp');
  } else {
    preprocessing.push('marker-fallback-linear');
  }

  const correctedName = `corrected-${path.basename(inputPath).replace(/\.[^.]+$/, '')}.jpg`;
  const correctedPath = path.join(outputDir, correctedName);

  await sharp(working.data, {
    raw: { width: working.width, height: working.height, channels: working.channels },
  })
    .grayscale()
    .normalize()
    .sharpen()
    .jpeg({ quality: 92 })
    .toFile(correctedPath);

  return {
    correctedPath,
    correctedRelativePath: `/uploads/${correctedName}`,
    width: working.width,
    height: working.height,
    canonical: markerResult.reliable,
    markerDetection: {
      detectedCount: markerResult.detectedCount,
      highConfidence: markerResult.highConfidence,
      points: markerResult.points,
    },
    preprocessing: [...preprocessing, 'grayscale', 'normalize', 'sharpen'],
    pageSize: { widthMm: 210, heightMm: 297 },
    outputSize: markerResult.reliable ? { width: OUT_WIDTH, height: OUT_HEIGHT } : { width: working.width, height: working.height },
  };
}

module.exports = { prepareAnswerSheetImage, OUT_WIDTH, OUT_HEIGHT };
