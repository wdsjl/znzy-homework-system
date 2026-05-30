const crypto = require('crypto');
const QRCode = require('qrcode');

const PAGE = {
  unit: 'mm',
  width: 210,
  height: 297,
  margin: 12,
  dpi: 300,
};

function stableId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function buildQrPayload(input = {}) {
  return {
    paperId: input.paperId || input.paperNo || stableId('paper'),
    studentId: input.studentId || '',
    assignmentId: input.assignmentId || '',
    templateVersion: input.templateVersion || 'answer-sheet-v1',
  };
}

async function createQrDataUrl(payload) {
  return QRCode.toDataURL(JSON.stringify(payload), {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 240,
    color: {
      dark: '#111827',
      light: '#ffffff',
    },
  });
}

function isObjectiveType(type = '') {
  return type.includes('选') || type.includes('判断');
}

function questionNo(question, index) {
  const raw = question.displayNo ?? question.no ?? question.sortNo ?? question.id ?? index + 1;
  const numeric = Number(raw);
  return Number.isFinite(numeric) && String(raw).trim() !== '' ? numeric : index + 1;
}

function bbox(x, y, width, height) {
  return { x: round(x), y: round(y), width: round(width), height: round(height) };
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function buildAnswerSheetLayout(input = {}) {
  const questions = Array.isArray(input.questions) ? input.questions : [];
  const qrPayload = buildQrPayload(input);
  const answerAreas = [];
  let page = 1;
  let y = 62;
  const leftX = 16;
  const rightX = 108;
  const objectiveWidth = 86;
  const subjectWidth = 178;
  const bottom = PAGE.height - 18;

  const ensureSpace = (height) => {
    if (y + height > bottom) {
      page += 1;
      y = 24;
    }
  };

  questions.forEach((question, index) => {
    const type = String(question.type || question.questionType || '');
    const no = questionNo(question, index);
    if (isObjectiveType(type)) {
      const column = answerAreas.filter((area) => area.page === page && area.kind === 'objective').length % 2;
      const x = column === 0 ? leftX : rightX;
      if (column === 0) ensureSpace(10);
      const rowY = y;
      const options = (type.includes('判断') ? ['√', '×'] : ['A', 'B', 'C', 'D']).map((key, optionIndex) => ({
        key,
        circle: {
          cx: round(x + 24 + optionIndex * 10),
          cy: round(rowY + 4.2),
          r: 3.2,
        },
      }));
      answerAreas.push({
        questionId: String(question.id ?? no),
        questionNo: no,
        type,
        kind: 'objective',
        score: Number(question.score || 0),
        page,
        bbox: bbox(x, rowY, objectiveWidth, 8.5),
        options,
      });
      if (column === 1) y += 10.5;
      return;
    }

    const height = type.includes('解答') || type.includes('分析') ? 38 : 24;
    ensureSpace(height + 8);
    answerAreas.push({
      questionId: String(question.id ?? no),
      questionNo: no,
      type,
      kind: 'subjective',
      score: Number(question.score || 0),
      page,
      bbox: bbox(leftX, y, subjectWidth, height),
      needsManualReview: true,
    });
    y += height + 8;
  });

  return {
    layoutId: stableId('layout'),
    paperId: qrPayload.paperId,
    studentId: qrPayload.studentId,
    assignmentId: qrPayload.assignmentId,
    templateVersion: qrPayload.templateVersion,
    generatedAt: new Date().toISOString(),
    page: PAGE,
    markers: [
      { key: 'tl', page: 1, bbox: bbox(8, 8, 10, 10) },
      { key: 'tr', page: 1, bbox: bbox(192, 8, 10, 10) },
      { key: 'bl', page: 1, bbox: bbox(8, 279, 10, 10) },
      { key: 'br', page: 1, bbox: bbox(192, 279, 10, 10) },
    ],
    qr: {
      payload: qrPayload,
      bbox: bbox(174, 14, 24, 24),
    },
    studentInfo: {
      bbox: bbox(16, 16, 150, 22),
      fields: [
        { key: 'school', label: 'school', bbox: bbox(16, 32, 32, 6) },
        { key: 'name', label: 'name', bbox: bbox(54, 32, 28, 6) },
        { key: 'className', label: 'class', bbox: bbox(88, 32, 28, 6) },
        { key: 'examNo', label: 'examNo', bbox: bbox(122, 32, 34, 6) },
      ],
    },
    answerAreas,
  };
}

function normalizeAnswer(type = '', answer = '') {
  const raw = String(answer ?? '').trim();
  if (!raw) return '';
  if (type.includes('判断')) {
    if (/^(√|对|正确|TRUE|T|YES|Y)$/i.test(raw)) return '√';
    if (/^(×|错|错误|FALSE|F|NO|N)$/i.test(raw)) return '×';
  }
  return raw
    .toUpperCase()
    .replace(/[，,、\s]/g, '')
    .split('')
    .filter(Boolean)
    .sort()
    .join('');
}

function getCorrectAnswer(question) {
  return question.answer ?? question.ans ?? question.correctAnswer ?? '';
}

function getQuestionScore(question) {
  return Number(question.score || question.points || 0);
}

function gradeObjectiveAnswers(questions = [], recognizedAnswers = {}) {
  let objectiveScore = 0;
  let objectiveFullScore = 0;
  const details = [];

  for (const [index, question] of questions.entries()) {
    const type = String(question.type || question.questionType || '');
    const no = questionNo(question, index);
    const score = getQuestionScore(question);
    const keyCandidates = [String(question.id ?? ''), String(no), String(index + 1)].filter(Boolean);
    const rawAnswer = keyCandidates.map((key) => recognizedAnswers[key]).find((value) => value !== undefined);

    if (!isObjectiveType(type)) {
      details.push({
        questionId: String(question.id ?? no),
        questionNo: no,
        type,
        kind: 'subjective',
        score: 0,
        fullScore: score,
        recognizedAnswer: rawAnswer ?? '',
        correctAnswer: getCorrectAnswer(question),
        status: 'needs_manual_review',
      });
      continue;
    }

    objectiveFullScore += score;
    const normalizedRecognized = normalizeAnswer(type, rawAnswer);
    const normalizedCorrect = normalizeAnswer(type, getCorrectAnswer(question));
    const correct = Boolean(normalizedCorrect) && normalizedRecognized === normalizedCorrect;
    const gained = correct ? score : 0;
    objectiveScore += gained;
    details.push({
      questionId: String(question.id ?? no),
      questionNo: no,
      type,
      kind: 'objective',
      score: gained,
      fullScore: score,
      recognizedAnswer: rawAnswer ?? '',
      correctAnswer: getCorrectAnswer(question),
      correct,
      status: correct ? 'correct' : 'wrong',
    });
  }

  return {
    objectiveScore,
    objectiveFullScore,
    subjectiveFullScore: details
      .filter((item) => item.kind === 'subjective')
      .reduce((sum, item) => sum + Number(item.fullScore || 0), 0),
    details,
  };
}

function mockRecognizeAnswers(questions = [], seed = '') {
  const result = {};
  for (const [index, question] of questions.entries()) {
    const type = String(question.type || question.questionType || '');
    if (!isObjectiveType(type)) continue;
    const no = questionNo(question, index);
    const correct = String(getCorrectAnswer(question) || '').trim();
    const digest = crypto.createHash('sha1').update(`${seed}:${question.id ?? no}`).digest('hex');
    const value = parseInt(digest.slice(0, 8), 16);
    if (value % 100 < 82 && correct) {
      result[String(question.id ?? no)] = correct;
      result[String(no)] = correct;
      continue;
    }
    if (type.includes('判断')) {
      const wrong = normalizeAnswer(type, correct) === '√' ? '×' : '√';
      result[String(question.id ?? no)] = wrong;
      result[String(no)] = wrong;
      continue;
    }
    const choices = ['A', 'B', 'C', 'D'];
    const wrong = choices.find((choice) => !normalizeAnswer(type, correct).includes(choice)) || choices[value % choices.length];
    result[String(question.id ?? no)] = wrong;
    result[String(no)] = wrong;
  }
  return result;
}

module.exports = {
  buildAnswerSheetLayout,
  buildQrPayload,
  createQrDataUrl,
  gradeObjectiveAnswers,
  isObjectiveType,
  mockRecognizeAnswers,
  normalizeAnswer,
};
