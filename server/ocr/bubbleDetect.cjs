const sharp = require('sharp');

const FILL_THRESHOLD = 0.18;

function mapRegionToPixels(region, imageSize, pageSize) {
  const scaleX = imageSize.width / pageSize.widthMm;
  const scaleY = imageSize.height / pageSize.heightMm;
  const widthMm = region.widthMm || region.width || 10;
  const heightMm = region.heightMm || region.height || 10;
  const left = Math.max(0, Math.round(region.x * scaleX));
  const top = Math.max(0, Math.round(region.y * scaleY));
  const width = Math.max(1, Math.round(widthMm * scaleX));
  const height = Math.max(1, Math.round(heightMm * scaleY));
  const maxWidth = Math.max(1, imageSize.width - left);
  const maxHeight = Math.max(1, imageSize.height - top);
  return {
    left,
    top,
    width: Math.min(width, maxWidth),
    height: Math.min(height, maxHeight),
  };
}

async function measureDarkRatio(imagePath, rect) {
  const { data } = await sharp(imagePath)
    .extract(rect)
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (!data.length) return 0;
  let dark = 0;
  for (let i = 0; i < data.length; i += 1) {
    if (data[i] < 140) dark += 1;
  }
  return dark / data.length;
}

async function detectChoiceAnswer(imagePath, choiceRegions, imageSize, pageSize) {
  const scored = [];
  for (const region of choiceRegions) {
    const rect = mapRegionToPixels(region, imageSize, pageSize);
    const ratio = await measureDarkRatio(imagePath, rect);
    scored.push({ option: region.option, ratio, rect });
  }
  scored.sort((a, b) => b.ratio - a.ratio);
  const best = scored[0];
  if (!best || best.ratio < FILL_THRESHOLD) {
    return { answer: '', confidence: best?.ratio || 0, scored };
  }
  const multi = scored.filter((x) => x.ratio >= FILL_THRESHOLD).map((x) => x.option);
  const isMulti = multi.length > 1 && multi.every((x) => /^[A-D]$/.test(x));
  return {
    answer: isMulti ? multi.sort().join('') : best.option,
    confidence: Number(best.ratio.toFixed(3)),
    scored,
  };
}

module.exports = { detectChoiceAnswer, mapRegionToPixels, measureDarkRatio, FILL_THRESHOLD };
