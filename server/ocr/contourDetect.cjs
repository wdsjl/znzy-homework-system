function toGray(data, width, height, channels, idx) {
  if (channels === 1) return data[idx];
  const base = idx * channels;
  return Math.round(data[base] * 0.299 + data[base + 1] * 0.587 + data[base + 2] * 0.114);
}

function buildBinaryMask(data, width, height, channels, threshold = 140) {
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i += 1) {
    mask[i] = toGray(data, width, height, channels, i) < threshold ? 1 : 0;
  }
  return mask;
}

function findLargestBlobCentroid(mask, width, height, x0, y0, x1, y1) {
  const visited = new Uint8Array(width * height);
  const left = Math.max(0, Math.floor(x0));
  const top = Math.max(0, Math.floor(y0));
  const right = Math.min(width, Math.ceil(x1));
  const bottom = Math.min(height, Math.ceil(y1));
  let best = null;

  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const start = y * width + x;
      if (!mask[start] || visited[start]) continue;

      const queue = [start];
      visited[start] = 1;
      let count = 0;
      let sumX = 0;
      let sumY = 0;

      while (queue.length) {
        const cur = queue.pop();
        const cy = Math.floor(cur / width);
        const cx = cur - cy * width;
        count += 1;
        sumX += cx;
        sumY += cy;

        const neighbors = [
          [cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1],
          [cx - 1, cy - 1], [cx + 1, cy - 1], [cx - 1, cy + 1], [cx + 1, cy + 1],
        ];
        for (const [nx, ny] of neighbors) {
          if (nx < left || nx >= right || ny < top || ny >= bottom) continue;
          const ni = ny * width + nx;
          if (!mask[ni] || visited[ni]) continue;
          visited[ni] = 1;
          queue.push(ni);
        }
      }

      if (!best || count > best.count) {
        best = { x: sumX / count, y: sumY / count, count, area: count };
      }
    }
  }

  return best;
}

function detectCornerBlob(mask, width, height, corner) {
  const searchW = width * 0.3;
  const searchH = height * 0.3;
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

  const blob = findLargestBlobCentroid(mask, width, height, x0, y0, x1, y1);
  const minArea = Math.max(80, (searchW * searchH) * 0.001);
  if (!blob || blob.area < minArea) return null;
  return blob;
}

function detectMarkersByContour({ data, width, height, channels }) {
  const thresholds = [125, 140, 155];
  let bestResult = null;

  for (const threshold of thresholds) {
    const mask = buildBinaryMask(data, width, height, channels, threshold);
    const corners = ['tl', 'tr', 'br', 'bl'];
    const points = {};
    let detectedCount = 0;
    let totalArea = 0;

    for (const corner of corners) {
      const blob = detectCornerBlob(mask, width, height, corner);
      if (blob) {
        points[corner] = { x: blob.x, y: blob.y, detected: true, weight: blob.area, method: 'contour' };
        detectedCount += 1;
        totalArea += blob.area;
      } else {
        points[corner] = { detected: false, method: 'contour' };
      }
    }

    const candidate = { points, detectedCount, totalArea, threshold };
    if (!bestResult || detectedCount > bestResult.detectedCount || (detectedCount === bestResult.detectedCount && totalArea > bestResult.totalArea)) {
      bestResult = candidate;
    }
  }

  return bestResult || { points: {}, detectedCount: 0, totalArea: 0, threshold: 140 };
}

module.exports = {
  detectMarkersByContour,
  buildBinaryMask,
  findLargestBlobCentroid,
};
