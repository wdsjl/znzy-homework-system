const Tesseract = require('tesseract.js');
const sharp = require('sharp');
const { mapRegionToPixels } = require('./bubbleDetect.cjs');

async function recognizeTextRegion(imagePath, region, imageSize, pageSize) {
  const rect = mapRegionToPixels(region, imageSize, pageSize);
  const cropPath = `${imagePath}.ocr-${region.x}-${region.y}.png`;
  await sharp(imagePath)
    .extract(rect)
    .png()
    .toFile(cropPath);

  const result = await Tesseract.recognize(cropPath, 'chi_sim+eng', {
    logger: () => {},
  });
  const text = String(result.data?.text || '')
    .replace(/\s+/g, '')
    .replace(/[，,、；;]/g, '')
    .trim();
  const confidence = Number(((result.data?.confidence || 0) / 100).toFixed(2));
  return { text, confidence, cropPath };
}

module.exports = { recognizeTextRegion };
