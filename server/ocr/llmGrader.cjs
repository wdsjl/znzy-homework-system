function isLlmEnabled() {
  return Boolean(process.env.LLM_API_KEY);
}

function shouldUseLlm({ questionType, fuzzyResult }) {
  if (!isLlmEnabled()) return false;
  if (questionType?.includes('解答')) return true;
  if (!fuzzyResult) return false;
  return fuzzyResult.reviewSuggested || (fuzzyResult.similarity ?? 0) < 0.88;
}

async function scoreWithLlm({ stem, expected, detected, fullScore, questionType, analysis }) {
  if (!isLlmEnabled()) return null;

  const url = process.env.LLM_API_URL || 'https://api.openai.com/v1/chat/completions';
  const model = process.env.LLM_MODEL || 'gpt-4o-mini';
  const system = '你是中小学理科作业批改助手。根据题干、标准答案和识别到的学生作答，给出 JSON 判分结果。';
  const user = JSON.stringify({
    questionType,
    stem,
    expectedAnswer: expected,
    studentAnswer: detected,
    fullScore,
    analysis,
    outputFormat: {
      score: 'number 0-fullScore',
      similarity: 'number 0-1',
      correct: 'boolean',
      reviewSuggested: 'boolean',
      verdict: 'string 中文简短判语',
    },
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(process.env.LLM_TIMEOUT_MS || 12000));

  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${process.env.LLM_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: `请批改并仅返回 JSON：${user}` },
        ],
      }),
    });

    if (!res.ok) return null;
    const json = await res.json();
    const content = json.choices?.[0]?.message?.content;
    if (!content) return null;
    const parsed = JSON.parse(content);
    const score = Math.max(0, Math.min(Number(fullScore || 0), Number(parsed.score || 0)));
    const similarity = Math.max(0, Math.min(1, Number(parsed.similarity ?? 0)));
    return {
      score,
      correct: Boolean(parsed.correct),
      similarity: Number(similarity.toFixed(3)),
      reviewSuggested: Boolean(parsed.reviewSuggested),
      aiVerdict: parsed.verdict || 'LLM 语义判分',
      scoringMode: 'llm',
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { isLlmEnabled, shouldUseLlm, scoreWithLlm };
