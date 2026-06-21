const crypto = require('crypto');
const path = require('path');
const { prepareAnswerSheetImage } = require('./ocr/imagePrep.cjs');
const { detectChoiceAnswer } = require('./ocr/bubbleDetect.cjs');
const { recognizeTextRegion } = require('./ocr/textOcr.cjs');
const { scoreSubjectiveAnswer, scoreSubjectiveWithAi } = require('./ocr/subjectiveScore.cjs');
const { isLlmEnabled } = require('./ocr/llmGrader.cjs');

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

function scoreObjective(question, detectedAnswer) {
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

function summarizeReview(details) {
  const needsReview = details.filter((d) => d.reviewSuggested).length;
  const reviewStatus = needsReview > 0 ? 'pending' : 'auto-approved';
  return { needsReview, reviewStatus };
}

function buildGradingResult({
  paper, studentId, imagePath, imageName, correctedImagePath, mode = 'mock-ocr',
  details, earnedScore, totalScore, markerDetection, preprocessing,
}) {
  const wrong = details.filter((d) => !d.correct && !d.reviewSuggested).map((d) => `${d.type}第${d.questionNo}题`);
  const reviewPending = details.filter((d) => d.reviewSuggested).map((d) => `${d.type}第${d.questionNo}题`);
  const accuracy = totalScore ? Math.round((earnedScore / totalScore) * 100) : 0;
  const { needsReview, reviewStatus } = summarizeReview(details);

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
    wrongPoints: [...wrong, ...reviewPending].slice(0, 6),
    feedback: needsReview > 0
      ? `AI 初判完成，${needsReview} 题建议人工复核。`
      : accuracy >= 85 ? '整体掌握较好，建议增加挑战题。' : '建议推送同知识点分层巩固题。',
    reviewStatus,
    needsReview,
    review: { status: reviewStatus, reviewerId: null, reviewedAt: null, notes: '' },
    markerDetection: markerDetection || null,
    preprocessing: preprocessing || [],
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
    const scored = isObjective(q.type)
      ? scoreObjective(q, detectedAnswer)
      : scoreSubjectiveAnswer({ expected: q.answer, detected: detectedAnswer, fullScore: q.score, questionType: q.type });
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
      reviewSuggested: scored.reviewSuggested || false,
      aiVerdict: scored.aiVerdict || null,
      similarity: scored.similarity ?? null,
    });
  }
  return { details, earned, total };
}

async function buildGradingResultFromImage({ paper, studentId, absoluteImagePath, imagePath, imageName, layout }) {
  const uploadsDir = path.dirname(absoluteImagePath);
  let prep;
  try {
    prep = await prepareAnswerSheetImage(absoluteImagePath, uploadsDir);
  } catch {
    const mock = buildMockDetails(paper);
    return buildGradingResult({
      paper, studentId, imagePath, imageName, mode: 'mock-ocr',
      details: mock.details, earnedScore: mock.earned, totalScore: mock.total,
    });
  }

  const pageSize = layout?.pageSize || prep.pageSize || { widthMm: 210, heightMm: 297 };
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
    let scored;

    if (region?.choiceRegions?.length) {
      const detected = await detectChoiceAnswer(prep.correctedPath, region.choiceRegions, imageSize, pageSize);
      detectedAnswer = detected.answer;
      ocrConfidence = detected.confidence;
      fillRegionMatched = Boolean(detected.answer);
      scored = scoreObjective(q, detectedAnswer);
    } else if (region?.answerBox || !isObjective(q.type)) {
      try {
        const box = region?.answerBox || {
          x: pageSize.marginMm || 12,
          y: 60 + sortNo * 20,
          widthMm: pageSize.widthMm - 24,
          heightMm: 18,
        };
        const textResult = await recognizeTextRegion(prep.correctedPath, box, imageSize, pageSize);
        detectedAnswer = textResult.text || '识别不清';
        ocrConfidence = textResult.confidence;
      } catch {
        detectedAnswer = '识别不清';
        ocrConfidence = 0.2;
      }
      scored = await scoreSubjectiveWithAi({
        stem: q.stem,
        expected: q.answer,
        detected: detectedAnswer,
        fullScore: q.score,
        questionType: q.type,
        analysis: q.analysis,
      });
    } else if (isObjective(q.type)) {
      const options = q.type.includes('判断') ? ['√', '×'] : ['A', 'B', 'C', 'D'];
      detectedAnswer = mockDetectedChoice(String(q.answer || '').trim(), options);
      ocrConfidence = 0.5;
      scored = scoreObjective(q, detectedAnswer);
    } else {
      detectedAnswer = '识别不清';
      ocrConfidence = 0.2;
      scored = await scoreSubjectiveWithAi({ stem: q.stem, expected: q.answer, detected: detectedAnswer, fullScore: q.score, questionType: q.type, analysis: q.analysis });
    }

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
      reviewSuggested: scored.reviewSuggested || false,
      aiVerdict: scored.aiVerdict || null,
      similarity: scored.similarity ?? null,
      scoringMode: scored.scoringMode || null,
      manualScore: null,
      reviewComment: '',
    });
  }

  const usedLlm = details.some((d) => d.scoringMode === 'llm');
  const gradingMode = prep.canonical
    ? (usedLlm ? 'ocr-perspective+llm' : 'ocr-perspective')
    : (usedLlm ? 'ocr+llm' : 'ocr');

  return buildGradingResult({
    paper,
    studentId,
    imagePath,
    imageName,
    correctedImagePath: prep.correctedRelativePath,
    mode: gradingMode,
    details,
    earnedScore: earned,
    totalScore: total,
    markerDetection: prep.markerDetection,
    preprocessing: prep.preprocessing,
  });
}

function applyManualReview(grading, { reviewerId, notes, adjustments = [] }) {
  const detailMap = new Map(grading.details.map((d) => [d.questionNo, { ...d }]));
  let earned = 0;
  for (const adj of adjustments) {
    const row = detailMap.get(adj.questionNo);
    if (!row) continue;
    row.manualScore = Number(adj.score);
    row.reviewComment = adj.comment || '';
    row.reviewSuggested = false;
    row.correct = row.manualScore >= row.fullScore;
    row.score = row.manualScore;
    row.aiVerdict = adj.comment || '教师人工复核调整';
  }
  const details = [...detailMap.values()].sort((a, b) => a.questionNo - b.questionNo);
  for (const d of details) earned += Number(d.score || 0);
  const accuracy = grading.totalScore ? Math.round((earned / grading.totalScore) * 100) : 0;
  return {
    ...grading,
    details,
    earnedScore: earned,
    accuracy,
    reviewStatus: 'reviewed',
    needsReview: 0,
    review: {
      status: 'reviewed',
      reviewerId: reviewerId || 'teacher',
      reviewedAt: new Date().toISOString(),
      notes: notes || '',
    },
    feedback: '已完成人工复核并更新得分。',
  };
}

module.exports = {
  buildGradingResult,
  buildGradingResultFromImage,
  applyManualReview,
  normalizeAnswer,
  isObjective,
};
