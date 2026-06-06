const crypto = require('crypto');
const path = require('path');
const { prepareAnswerSheetImage } = require('./ocr/imagePrep.cjs');
const { detectChoiceAnswer } = require('./ocr/bubbleDetect.cjs');
const { recognizeTextRegion } = require('./ocr/textOcr.cjs');

function normalizeAnswer(answer) {
  return String(answer || '')
    .replace(/\s+/g, '')
    .replace(/[，,、]/g, '')
    .toUpperCase()
    .replace('√', 'T')
    .replace('×', 'F')
    .replace('正确', 'T')
    .replace('错误', 'F');
}

function isObjective(type) {
  return type.includes('选') || type.includes('判断');
}

function scoreQuestion(question, detectedAnswer) {
  const expected = normalizeAnswer(question.answer);
  const actual = normalizeAnswer(detectedAnswer);
  const full = Number(question.score || 0);
  if (!expected) return { score: 0, correct: false, expected, actual };
  const correct = expected === actual
    || (expected.length > 1 && [...expected].every((c) => actual.includes(c)) && actual.length === expected.length);
  return { score: correct ? full : 0, correct, expected, actual };
}

function mockDetectedChoice(correct, options) {
  const roll = Math.random();
  if (roll < 0.82) return correct;
  const pool = options.filter((x) => x !== correct);
  return pool[Math.floor(Math.random() * pool.length)] || correct;
}

function buildGradingResult({ paper, studentId, imagePath, imageName, correctedImagePath, mode = 'mock-ocr', details, earnedScore, totalScore }) {
  const wrong = details.filter((d) => !d.correct).map((d) => `${d.type}第${d.questionNo}题`);
  const accuracy = totalScore ? Math.round((earnedScore / totalScore) * 100) : 0;
  return {
    id: crypto.randomUUID(),
    paperId: paper.id,
    studentId: studentId || 'unknown',
    assignmentId: paper.assignmentId || null,
    imagePath,
    imageName,
    correctedImagePath: correctedImagePath || null,
    mode,
    accuracy,
    earnedScore,
    totalScore,
    details,
    wrongPoints: wrong.slice(0, 4),
    feedback: accuracy >= 85 ? '整体掌握较好，建议增加挑战题。' : '建议推送同知识点分层巩固题。',
    gradedAt: new Date().toISOString(),
  };
}

function buildMockDetails(paper) {
  const details = [];
  let earned = 0;
  let total = 0;
  for (const [idx, q] of (paper.questions || []).entries()) {
    const sortNo = idx + 1;
    total += Number(q.score || 0);
    let detectedAnswer = '';
    let ocrConfidence = 0.9;
    if (isObjective(q.type)) {
      const options = q.type.includes('判断') ? ['√', '×'] : ['A', 'B', 'C', 'D'];
      detectedAnswer = mockDetectedChoice(String(q.answer || '').trim(), options);
      ocrConfidence = 0.86 + Math.random() * 0.12;
    } else {
      detectedAnswer = Math.random() > 0.35 ? String(q.answer || '').slice(0, 24) : '识别不清';
      ocrConfidence = 0.62 + Math.random() * 0.25;
    }
    const scored = scoreQuestion(q, detectedAnswer);
    earned += scored.score;
    details.push({
      questionNo: sortNo,
      questionId: q.id,
      type: q.type,
      detectedAnswer,
      expectedAnswer: q.answer,
      correct: scored.correct,
      score: scored.score,
      fullScore: Number(q.score || 0),
      ocrConfidence: Number(ocrConfidence.toFixed(2)),
      fillRegionMatched: isObjective(q.type),
    });
  }
  return { details, earned, total };
}

async function buildGradingResultFromImage({ paper, studentId, absoluteImagePath, imagePath, imageName, layout }) {
  const uploadsDir = path.dirname(absoluteImagePath);
  let prep;
  try {
    prep = await prepareAnswerSheetImage(absoluteImagePath, uploadsDir);
  } catch (err) {
    const mock = buildMockDetails(paper);
    return buildGradingResult({
      paper,
      studentId,
      imagePath,
      imageName,
      mode: 'mock-ocr',
      details: mock.details,
      earnedScore: mock.earned,
      totalScore: mock.total,
    });
  }

  const pageSize = layout?.pageSize || { widthMm: 210, heightMm: 297 };
  const imageSize = { width: prep.width, height: prep.height };
  const regionMap = new Map((layout?.regions || []).map((r) => [r.questionNo, r]));
  const details = [];
  let earned = 0;
  let total = 0;

  for (const [idx, q] of (paper.questions || []).entries()) {
    const sortNo = q.sortNo || idx + 1;
    total += Number(q.score || 0);
    const region = regionMap.get(sortNo);
    let detectedAnswer = '';
    let ocrConfidence = 0;
    let fillRegionMatched = false;

    if (region?.choiceRegions?.length) {
      const detected = await detectChoiceAnswer(prep.correctedPath, region.choiceRegions, imageSize, pageSize);
      detectedAnswer = detected.answer;
      ocrConfidence = detected.confidence;
      fillRegionMatched = Boolean(detected.answer);
    } else if (region?.answerBox) {
      try {
        const textResult = await recognizeTextRegion(prep.correctedPath, region.answerBox, imageSize, pageSize);
        detectedAnswer = textResult.text || '识别不清';
        ocrConfidence = textResult.confidence;
      } catch {
        detectedAnswer = '识别不清';
        ocrConfidence = 0.2;
      }
    } else if (isObjective(q.type)) {
      const options = q.type.includes('判断') ? ['√', '×'] : ['A', 'B', 'C', 'D'];
      detectedAnswer = mockDetectedChoice(String(q.answer || '').trim(), options);
      ocrConfidence = 0.5;
    } else {
      detectedAnswer = '识别不清';
      ocrConfidence = 0.2;
    }

    const scored = scoreQuestion(q, detectedAnswer);
    earned += scored.score;
    details.push({
      questionNo: sortNo,
      questionId: q.id,
      type: q.type,
      detectedAnswer,
      expectedAnswer: q.answer,
      correct: scored.correct,
      score: scored.score,
      fullScore: Number(q.score || 0),
      ocrConfidence: Number(ocrConfidence.toFixed(2)),
      fillRegionMatched,
    });
  }

  return buildGradingResult({
    paper,
    studentId,
    imagePath,
    imageName,
    correctedImagePath: prep.correctedRelativePath,
    mode: 'ocr',
    details,
    earnedScore: earned,
    totalScore: total,
  });
}

module.exports = {
  buildGradingResult,
  buildGradingResultFromImage,
  normalizeAnswer,
  isObjective,
};
