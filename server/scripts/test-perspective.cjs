const sharp = require('sharp');
const PerspT = require('perspective-transform');
const path = require('path');
const { prepareAnswerSheetImage } = require('../ocr/imagePrep.cjs');

async function main() {
  const outDir = path.join(__dirname, '..', 'uploads');
  const basePath = path.join(outDir, 'synthetic-sheet.jpg');
  const skewedPath = path.join(outDir, 'synthetic-skewed.jpg');

  const w = 1240;
  const h = 1754;
  const base = Buffer.alloc(w * h);
  base.fill(255);
  const drawSquare = (cx, cy, size) => {
    for (let y = cy; y < cy + size; y += 1) {
      for (let x = cx; x < cx + size; x += 1) {
        if (x >= 0 && x < w && y >= 0 && y < h) base[y * w + x] = 0;
      }
    }
  };
  drawSquare(90, 90, 80);
  drawSquare(w - 170, 90, 80);
  drawSquare(90, h - 170, 80);
  drawSquare(w - 170, h - 170, 80);

  await sharp(base, { raw: { width: w, height: h, channels: 1 } }).jpeg().toFile(basePath);

  const src = [90, 90, w - 90, 90, w - 90, h - 90, 90, h - 90];
  const dst = [120, 160, w - 80, 120, w - 40, h - 60, 60, h - 120];
  const transform = PerspT(src, dst);
  const skewed = Buffer.alloc(w * h * 3);
  skewed.fill(255);
  const { data } = await sharp(basePath).raw().toBuffer({ resolveWithObject: true });
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const [sx, sy] = transform.transformInverse(x, y);
      const sx0 = Math.max(0, Math.min(w - 1, Math.round(sx)));
      const sy0 = Math.max(0, Math.min(h - 1, Math.round(sy)));
      const gray = data[sy0 * w + sx0];
      const idx = (y * w + x) * 3;
      skewed[idx] = gray;
      skewed[idx + 1] = gray;
      skewed[idx + 2] = gray;
    }
  }
  await sharp(skewed, { raw: { width: w, height: h, channels: 3 } }).jpeg().toFile(skewedPath);

  const prep = await prepareAnswerSheetImage(skewedPath, outDir);
  console.log(JSON.stringify({
    ok: true,
    canonical: prep.canonical,
    detectedCount: prep.markerDetection.detectedCount,
    contourCount: prep.markerDetection.contourCount,
    detectionMethod: prep.markerDetection.detectionMethod,
    preprocessing: prep.preprocessing,
    corrected: prep.correctedRelativePath,
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
