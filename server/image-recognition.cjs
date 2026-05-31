const sharp = require('sharp');
const jsQR = require('jsqr');

async function recognizeAnswerSheet({ buffer, layout, questions = [], uploadId, storage }) {
  const imageInfo = await inspectImage(buffer);
  const qr = await decodeQrPayload(buffer);
  const correction = await estimateCorrection(buffer);
  const omr = await recognizeObjectiveAnswers(buffer, layout);
  const subjectiveRegions = await cropSubjectiveRegions({ buffer, layout, uploadId, storage });
  const ocr = await recognizeSubjectiveText(subjectiveRegions);
  const aiPrecheck = buildSubjectivePrecheck({ questions, subjectiveRegions, ocr });

  return {
    imageInfo,
    qr,
    correction,
    omr,
    subjectiveRegions,
    ocr,
    aiPrecheck,
  };
}


async function decodeQrPayload(buffer) {
  try {
    const maxWidth = Number(process.env.QR_DECODE_WIDTH || 1400);
    const image = sharp(buffer)
      .resize({ width: maxWidth, withoutEnlargement: true })
      .ensureAlpha();
    const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
    const decoded = jsQR(new Uint8ClampedArray(data), info.width, info.height);
    if (!decoded?.data) return { status: 'not_found', payload: null, raw: '', location: null };
    let payload = null;
    try {
      payload = JSON.parse(decoded.data);
    } catch {
      payload = { raw: decoded.data };
    }
    return {
      status: 'decoded',
      payload,
      raw: decoded.data,
      location: decoded.location || null,
    };
  } catch (error) {
    return { status: 'failed', payload: null, raw: '', error: error.message };
  }
}

async function inspectImage(buffer) {
  try {
    const meta = await sharp(buffer).metadata();
    return {
      width: meta.width || 0,
      height: meta.height || 0,
      format: meta.format || 'unknown',
      hasAlpha: Boolean(meta.hasAlpha),
    };
  } catch (error) {
    return { width: 0, height: 0, format: 'invalid', error: error.message };
  }
}

async function estimateCorrection(buffer) {
  try {
    const meta = await sharp(buffer).metadata();
    const width = meta.width || 0;
    const height = meta.height || 0;
    const aspect = width && height ? width / height : 0;
    return {
      status: 'estimated',
      method: 'corner-marker-aspect-normalization',
      rotationApplied: 0,
      perspectiveApplied: false,
      confidence: aspect > 0.62 && aspect < 0.82 ? 0.72 : 0.45,
      note: '当前版本会基于答题卡 Layout 坐标做归一化采样；真实透视变换可替换此模块。',
    };
  } catch (error) {
    return { status: 'skipped', confidence: 0, error: error.message };
  }
}

async function recognizeObjectiveAnswers(buffer, layout) {
  if (!layout?.answerAreas?.length) {
    return { engine: 'layout-omr', status: 'skipped', answers: {}, confidence: 0, reason: 'missing-layout' };
  }

  try {
    const page = layout.page || { width: 210, height: 297 };
    const targetWidth = 2100;
    const targetHeight = Math.round(targetWidth * (Number(page.height || 297) / Number(page.width || 210)));
    const image = sharp(buffer).resize(targetWidth, targetHeight, { fit: 'fill' }).grayscale();
    const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
    const scaleX = info.width / Number(page.width || 210);
    const scaleY = info.height / Number(page.height || 297);
    const answers = {};
    const confidenceByQuestion = {};

    for (const area of layout.answerAreas.filter((item) => item.kind === 'objective' && item.options?.length)) {
      const readings = area.options.map((option) => {
        const cx = Math.round(option.circle.cx * scaleX);
        const cy = Math.round(option.circle.cy * scaleY);
        const r = Math.max(3, Math.round(option.circle.r * Math.min(scaleX, scaleY)));
        const darkness = sampleDarkness(data, info.width, info.height, cx, cy, r);
        return { key: option.key, darkness };
      });
      const max = Math.max(...readings.map((item) => item.darkness));
      const avg = readings.reduce((sum, item) => sum + item.darkness, 0) / readings.length;
      const threshold = Math.max(54, avg + 18);
      const selected = readings
        .filter((item) => item.darkness >= threshold && item.darkness >= max - 12)
        .map((item) => item.key);
      const answer = selected.length ? selected.join('') : (max > 70 ? readings.find((item) => item.darkness === max)?.key || '' : '');
      if (answer) {
        answers[String(area.questionId)] = answer;
        answers[String(area.questionNo)] = answer;
      }
      confidenceByQuestion[String(area.questionNo)] = Math.min(0.98, Math.max(0, (max - avg) / 120));
    }

    return {
      engine: 'layout-omr',
      status: 'recognized',
      answers,
      confidence: average(Object.values(confidenceByQuestion)),
      confidenceByQuestion,
    };
  } catch (error) {
    return { engine: 'layout-omr', status: 'failed', answers: {}, confidence: 0, error: error.message };
  }
}

async function cropSubjectiveRegions({ buffer, layout, uploadId, storage }) {
  if (!layout?.answerAreas?.length || !storage) return [];
  try {
    const meta = await sharp(buffer).metadata();
    const page = layout.page || { width: 210, height: 297 };
    const width = meta.width || 0;
    const height = meta.height || 0;
    if (!width || !height) return [];
    const scaleX = width / Number(page.width || 210);
    const scaleY = height / Number(page.height || 297);
    const regions = [];
    for (const area of layout.answerAreas.filter((item) => item.kind === 'subjective')) {
      const left = clamp(Math.floor(area.bbox.x * scaleX), 0, width - 1);
      const top = clamp(Math.floor(area.bbox.y * scaleY), 0, height - 1);
      const cropWidth = clamp(Math.ceil(area.bbox.width * scaleX), 1, width - left);
      const cropHeight = clamp(Math.ceil(area.bbox.height * scaleY), 1, height - top);
      const cropBuffer = await sharp(buffer)
        .extract({ left, top, width: cropWidth, height: cropHeight })
        .png()
        .toBuffer();
      const saved = await storage.saveBuffer({
        buffer: cropBuffer,
        fileName: `${uploadId}-q${area.questionNo}.png`,
        contentType: 'image/png',
        folder: 'grading/subjective',
      });
      regions.push({
        questionId: area.questionId,
        questionNo: area.questionNo,
        type: area.type,
        bbox: area.bbox,
        imageUrl: saved.url,
        storageKey: saved.key,
      });
    }
    return regions;
  } catch {
    return [];
  }
}

async function recognizeSubjectiveText(regions) {
  if (process.env.OCR_ENABLED !== '1') {
    return { engine: 'tesseract.js', status: 'disabled', results: [] };
  }
  try {
    const { createWorker } = require('tesseract.js');
    const worker = await createWorker(process.env.OCR_LANG || 'chi_sim+eng');
    const results = [];
    for (const region of regions) {
      if (!region.imageUrl || !region.imageUrl.startsWith('/')) continue;
      const { data } = await worker.recognize(region.imageUrl);
      results.push({ questionNo: region.questionNo, text: data.text || '', confidence: data.confidence || 0 });
    }
    await worker.terminate();
    return { engine: 'tesseract.js', status: 'recognized', results };
  } catch (error) {
    return { engine: 'tesseract.js', status: 'failed', error: error.message, results: [] };
  }
}

function buildSubjectivePrecheck({ questions, subjectiveRegions, ocr }) {
  const results = subjectiveRegions.map((region) => {
    const question = questions.find((item) => String(item.id) === String(region.questionId) || String(item.id) === String(region.questionNo));
    const text = (ocr.results || []).find((item) => item.questionNo === region.questionNo)?.text || '';
    const answer = String(question?.answer || question?.ans || '');
    const similarity = text && answer ? simpleSimilarity(text, answer) : 0;
    const fallbackRate = Number(process.env.DEFAULT_AI_SUBJECTIVE_RATE || 0.75);
    const suggestedScoreRate = text ? Math.max(0.4, Math.min(0.95, similarity)) : Math.max(0, Math.min(1, fallbackRate));
    return {
      questionNo: region.questionNo,
      status: text ? 'ai_prechecked' : 'rule_prechecked',
      suggestedScoreRate,
      reason: text ? '基于 OCR 文本与参考答案的相似度给出初判，仍建议教师复核。' : '未启用 OCR 或未识别到文本，按默认规则评分率给出初判建议。',
      ocrText: text,
    };
  });
  return { engine: 'rule-ai-precheck', status: results.length ? 'ready' : 'skipped', results };
}

function sampleDarkness(data, width, height, cx, cy, radius) {
  let sum = 0;
  let count = 0;
  for (let y = Math.max(0, cy - radius); y <= Math.min(height - 1, cy + radius); y += 1) {
    for (let x = Math.max(0, cx - radius); x <= Math.min(width - 1, cx + radius); x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > radius * radius) continue;
      sum += 255 - data[y * width + x];
      count += 1;
    }
  }
  return count ? sum / count : 0;
}

function simpleSimilarity(text, answer) {
  const a = new Set(String(text).replace(/\s/g, '').split(''));
  const b = new Set(String(answer).replace(/\s/g, '').split(''));
  if (!a.size || !b.size) return 0;
  let hit = 0;
  for (const ch of b) if (a.has(ch)) hit += 1;
  return hit / b.size;
}

function average(values) {
  const nums = values.filter((value) => Number.isFinite(value));
  if (!nums.length) return 0;
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

module.exports = { decodeQrPayload, recognizeAnswerSheet, recognizeObjectiveAnswers };
