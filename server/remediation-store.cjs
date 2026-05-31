const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

function createRemediationStore({ dataDir }) {
  const planFile = path.join(dataDir, 'remediation-plans.json');

  async function listWrongQuestions(records = [], filters = {}) {
    return records
      .flatMap((record) => extractWrongQuestions(record))
      .filter((item) =>
        (!filters.studentId || item.studentId === filters.studentId) &&
        (!filters.assignmentId || item.assignmentId === filters.assignmentId) &&
        (!filters.uploadId || item.uploadId === filters.uploadId)
      )
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  }

  async function createRemediationPlan({ records = [], questionStore, studentId = '', uploadId = '', assignmentId = '', count = 6 }) {
    const wrongQuestions = await listWrongQuestions(records, { studentId, uploadId, assignmentId });
    const source = wrongQuestions.slice(0, Math.max(1, Number(count || 6)));
    const bank = questionStore ? await questionStore.listQuestions() : [];
    const selected = [];
    const used = new Set();

    for (const wrong of source) {
      const candidate = bank.find((question) =>
        !used.has(question.id) &&
        question.type === wrong.type &&
        (!wrong.knowledge || question.knowledge === wrong.knowledge)
      ) || bank.find((question) => !used.has(question.id) && question.type === wrong.type);
      if (candidate) {
        used.add(candidate.id);
        selected.push({
          id: candidate.id,
          type: candidate.type,
          stem: candidate.stem,
          answer: candidate.answer,
          analysis: candidate.analysis,
          score: candidate.score,
          source: 'question-bank',
          remediationFor: wrong,
        });
      } else {
        selected.push({
          id: `wrong-${wrong.uploadId}-${wrong.questionNo}`,
          type: wrong.type,
          stem: `错题回练：第 ${wrong.questionNo} 题（${wrong.reason}）`,
          answer: wrong.correctAnswer || '待教师补充',
          analysis: wrong.reason,
          score: wrong.fullScore || 5,
          source: 'wrong-question',
          remediationFor: wrong,
        });
      }
    }

    const plan = {
      id: `rem_${crypto.randomUUID()}`,
      studentId,
      assignmentId: `remediation_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}_${crypto.randomUUID().slice(0, 8)}`,
      sourceAssignmentId: assignmentId,
      sourceUploadId: uploadId,
      title: '错题巩固再练',
      status: 'generated',
      sourceWrongCount: wrongQuestions.length,
      questions: selected,
      recommendations: buildRecommendations(wrongQuestions),
      createdAt: new Date().toISOString(),
    };
    await savePlan(plan);
    return plan;
  }

  async function listPlans(filters = {}) {
    const plans = await readPlans();
    return plans.filter((plan) =>
      (!filters.studentId || plan.studentId === filters.studentId) &&
      (!filters.assignmentId || plan.assignmentId === filters.assignmentId) &&
      (!filters.sourceUploadId || plan.sourceUploadId === filters.sourceUploadId)
    );
  }

  async function updatePlan(id, patch = {}) {
    const plans = await readPlans();
    const index = plans.findIndex((plan) => plan.id === id);
    if (index === -1) return null;
    plans[index] = { ...plans[index], ...patch, id, updatedAt: new Date().toISOString() };
    await writePlans(plans);
    return plans[index];
  }

  async function savePlan(plan) {
    const plans = await readPlans();
    const next = [plan, ...plans.filter((item) => item.id !== plan.id)].slice(0, 500);
    await writePlans(next);
  }

  async function readPlans() {
    try {
      const rows = JSON.parse(await fs.readFile(planFile, 'utf-8'));
      return Array.isArray(rows) ? rows : [];
    } catch {
      return [];
    }
  }

  async function writePlans(plans) {
    await fs.mkdir(path.dirname(planFile), { recursive: true });
    await fs.writeFile(planFile, JSON.stringify(plans, null, 2), 'utf-8');
  }

  return { createRemediationPlan, listPlans, listWrongQuestions, updatePlan };
}

function extractWrongQuestions(record = {}) {
  const details = record.grading?.details || [];
  return details
    .filter((detail) => detail.status === 'wrong' || (detail.kind === 'subjective' && Number(detail.score || 0) < Number(detail.fullScore || 0)))
    .map((detail) => ({
      id: `${record.uploadId}-${detail.questionNo}`,
      uploadId: record.uploadId,
      studentId: record.studentId || '',
      studentName: record.studentName || '',
      assignmentId: record.assignmentId || '',
      paperId: record.paperId || '',
      questionId: detail.questionId || '',
      questionNo: detail.questionNo,
      type: detail.type || '',
      knowledge: detail.knowledge || '',
      score: Number(detail.score || 0),
      fullScore: Number(detail.fullScore || 0),
      recognizedAnswer: detail.recognizedAnswer || '',
      correctAnswer: detail.correctAnswer || '',
      reason: buildReason(detail),
      status: detail.status,
      createdAt: record.createdAt || new Date().toISOString(),
    }));
}

function buildReason(detail) {
  if (detail.status === 'wrong') return `答案错误：${detail.recognizedAnswer || '空'} / ${detail.correctAnswer || '未配置'}`;
  if (detail.kind === 'subjective') return `主观题得分 ${detail.score || 0}/${detail.fullScore || 0}`;
  return '待巩固';
}

function buildRecommendations(wrongQuestions) {
  const typeCount = new Map();
  for (const item of wrongQuestions) typeCount.set(item.type || '未分类', (typeCount.get(item.type || '未分类') || 0) + 1);
  return [...typeCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([type, count]) => ({
      type,
      count,
      action: `安排 ${type} 错题变式与同类题限时训练`,
    }));
}

module.exports = { createRemediationStore, extractWrongQuestions };
