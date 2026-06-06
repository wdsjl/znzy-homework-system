function normalizeText(text) {
  return String(text || '')
    .replace(/\s+/g, '')
    .replace(/[，,。．.；;：:！!？?、]/g, '')
    .toLowerCase();
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i += 1) dp[i][0] = i;
  for (let j = 0; j <= n; j += 1) dp[0][j] = j;
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

function similarityRatio(a, b) {
  const left = normalizeText(a);
  const right = normalizeText(b);
  if (!left && !right) return 1;
  if (!left || !right) return 0;
  if (left === right) return 1;
  const dist = levenshtein(left, right);
  return 1 - dist / Math.max(left.length, right.length);
}

function extractNumbers(text) {
  return String(text || '').match(/-?\d+(?:\.\d+)?/g)?.map(Number) || [];
}

function scoreNumeric(expected, detected, tolerance = 0.05) {
  const expNums = extractNumbers(expected);
  const detNums = extractNumbers(detected);
  if (!expNums.length || !detNums.length) return null;
  const hits = expNums.filter((n) => detNums.some((m) => Math.abs(n - m) <= Math.max(tolerance, Math.abs(n) * tolerance)));
  return hits.length / expNums.length;
}

function scoreSubjectiveAnswer({ expected, detected, fullScore, questionType }) {
  const full = Number(fullScore || 0);
  const normalizedExpected = normalizeText(expected);
  const normalizedDetected = normalizeText(detected);

  if (!normalizedDetected || normalizedDetected === '识别不清') {
    return {
      score: 0,
      correct: false,
      similarity: 0,
      reviewSuggested: true,
      aiVerdict: '未识别到有效作答，建议人工复核',
      scoringMode: 'ai-fuzzy',
    };
  }

  if (normalizedExpected === normalizedDetected) {
    return {
      score: full,
      correct: true,
      similarity: 1,
      reviewSuggested: false,
      aiVerdict: '与标准答案一致',
      scoringMode: 'ai-fuzzy',
    };
  }

  const numericRatio = scoreNumeric(expected, detected);
  const textRatio = similarityRatio(expected, detected);
  const similarity = numericRatio != null ? Math.max(numericRatio, textRatio) : textRatio;

  if (similarity >= 0.88) {
    return {
      score: full,
      correct: true,
      similarity: Number(similarity.toFixed(3)),
      reviewSuggested: false,
      aiVerdict: '高度相似，自动判对',
      scoringMode: 'ai-fuzzy',
    };
  }

  if (similarity >= 0.62) {
    const partial = Math.round(full * 0.5 * 100) / 100;
    return {
      score: partial,
      correct: false,
      similarity: Number(similarity.toFixed(3)),
      reviewSuggested: true,
      aiVerdict: '部分匹配，AI 给予半分并建议人工复核',
      scoringMode: 'ai-fuzzy',
    };
  }

  if (similarity >= 0.35) {
    return {
      score: 0,
      correct: false,
      similarity: Number(similarity.toFixed(3)),
      reviewSuggested: true,
      aiVerdict: '相似度偏低，建议人工复核',
      scoringMode: 'ai-fuzzy',
    };
  }

  return {
    score: 0,
    correct: false,
    similarity: Number(similarity.toFixed(3)),
    reviewSuggested: questionType?.includes('解答'),
    aiVerdict: questionType?.includes('解答') ? '解答题差异较大，建议教师复核' : '作答与标准答案不匹配',
    scoringMode: 'ai-fuzzy',
  };
}

module.exports = { scoreSubjectiveAnswer, similarityRatio, normalizeText };
