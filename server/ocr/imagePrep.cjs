const path = require('path');
const sharp = require('sharp');

async function prepareAnswerSheetImage(inputPath, outputDir) {
  const meta = await sharp(inputPath).rotate().metadata();
  const correctedName = `corrected-${path.basename(inputPath)}`;
  const correctedPath = path.join(outputDir, correctedName);

  await sharp(inputPath)
    .rotate()
    .grayscale()
    .normalize()
    .sharpen()
    .jpeg({ quality: 92 })
    .toFile(correctedPath);

  const correctedMeta = await sharp(correctedPath).metadata();
  return {
    correctedPath,
    correctedRelativePath: `/uploads/${correctedName}`,
    width: correctedMeta.width || meta.width || 1,
    height: correctedMeta.height || meta.height || 1,
    preprocessing: ['exif-rotate', 'grayscale', 'normalize', 'sharpen'],
  };
}

module.exports = { prepareAnswerSheetImage };
