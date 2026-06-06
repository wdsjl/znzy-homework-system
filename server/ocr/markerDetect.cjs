const CANONICAL = { widthMm: 210, heightMm: 297 };
const ANCHOR_MM = {
  tl: { x: 20, y: 20 },
  tr: { x: 190, y: 20 },
  br: { x: 190, y: 277 },
  bl: { x: 20, y: 277 },
};

function centroidInRegion(data, width, height, channels, x0, y0, x1, y1, threshold = 145) {
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  const left = Math.max(0, Math.floor(x0));
  const top = Math.max(0, Math.floor(y0));
  const right = Math.min(width, Math.ceil(x1));
  const bottom = Math.min(height, Math.ceil(y1));

  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const idx = (y * width + x) * channels;
      const gray = channels >= 3
        ? Math.round(data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114)
        : data[idx];
      if (gray < threshold) {
        sumX += x;
        sumY += y;
        count += 1;
      }
    }
  }

  if (!count) return null;
  return { x: sumX / count, y: sumY / count, weight: count };
}

function detectCorner(data, width, height, channels, corner) {
  const searchW = width * 0.28;
  const searchH = height * 0.28;
  let x0;
  let y0;
  let x1;
  let y1;

  if (corner === 'tl') {
    x0 = 0; y0 = 0; x1 = searchW; y1 = searchH;
  } else if (corner === 'tr') {
    x0 = width - searchW; y0 = 0; x1 = width; y1 = searchH;
  } else if (corner === 'bl') {
    x0 = 0; y0 = height - searchH; x1 = searchW; y1 = height;
  } else {
    x0 = width - searchW; y0 = height - searchH; x1 = width; y1 = height;
  }

  const found = centroidInRegion(data, width, height, channels, x0, y0, x1, y1);
  if (!found) {
    const fallback = {
      tl: { x: searchW * 0.35, y: searchH * 0.35 },
      tr: { x: width - searchW * 0.35, y: searchH * 0.35 },
      bl: { x: searchW * 0.35, y: height - searchH * 0.35 },
      br: { x: width - searchW * 0.35, y: height - searchH * 0.35 },
    };
    return { ...fallback[corner], detected: false };
  }

  return { x: found.x, y: found.y, detected: true, weight: found.weight };
}

function detectMarkersFromRaw({ data, width, height, channels }) {
  const tl = detectCorner(data, width, height, channels, 'tl');
  const tr = detectCorner(data, width, height, channels, 'tr');
  const br = detectCorner(data, width, height, channels, 'br');
  const bl = detectCorner(data, width, height, channels, 'bl');
  const detectedCount = [tl, tr, br, bl].filter((p) => p.detected).length;
  return {
    points: { tl, tr, br, bl },
    detectedCount,
    reliable: detectedCount >= 2,
    highConfidence: detectedCount >= 3,
  };
}

function markersToSrcArray(points) {
  return [
    points.tl.x, points.tl.y,
    points.tr.x, points.tr.y,
    points.br.x, points.br.y,
    points.bl.x, points.bl.y,
  ];
}

function canonicalDstArray(outWidth, outHeight) {
  const sx = outWidth / CANONICAL.widthMm;
  const sy = outHeight / CANONICAL.heightMm;
  return [
    ANCHOR_MM.tl.x * sx, ANCHOR_MM.tl.y * sy,
    ANCHOR_MM.tr.x * sx, ANCHOR_MM.tr.y * sy,
    ANCHOR_MM.br.x * sx, ANCHOR_MM.br.y * sy,
    ANCHOR_MM.bl.x * sx, ANCHOR_MM.bl.y * sy,
  ];
}

module.exports = {
  detectMarkersFromRaw,
  markersToSrcArray,
  canonicalDstArray,
  CANONICAL,
  ANCHOR_MM,
};
