const crypto = require('crypto');

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

function mockDetectedChoice(correct, options) {
  const roll = Math.random();
  if (roll < 0.82) return correct;
  const pool = options.filter((x) => x !== correct);
  return pool[Math.floor(Math.random() * pool.length)] || correct;
}

function scoreQuestion(question, detectedAnswer) {
  const expected = normalizeAnswer(question.answer);
  const actual = normalizeAnswer(detectedAnswer);
  const full = Number(question.score || 0);
  if (!expected) return { score: 0, correct: false, expected, actual };
  const correct = expected === actual || (expected.length > 1 && [...expected].every((c) => actual.includes(c)) && actual.length === expected.length);
  return { score: correct ? full : 0, correct, expected, actual };
}

function buildGradingResult({ paper, studentId, imagePath, imageName }) {
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

  const accuracy = total ? Math.round((earned / total) * 100) : 0;
  const wrong = details.filter((d) => !d.correct).map((d) => `${d.type}第${d.questionNo}题`);

  return {
    id: crypto.randomUUID(),
    paperId: paper.id,
    studentId: studentId || 'unknown',
    assignmentId: paper.assignmentId || null,
    imagePath,
    imageName,
    mode: 'mock-ocr',
    accuracy,
    earnedScore: earned,
    totalScore: total,
    details,
    wrongPoints: wrong.slice(0, 4),
    feedback: accuracy >= 85 ? '整体掌握较好，建议增加挑战题。' : '建议推送同知识点分层巩固题。',
    gradedAt: new Date().toISOString(),
  };
}

module.exports = { buildGradingResult, normalizeAnswer, isObjective };
