function buildStudentProfile({ studentId = '', studentName = '', records = [] }) {
  const normalized = records
    .filter((record) => !studentId || record.studentId === studentId)
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  const completed = normalized.filter((record) => record.grading && Number(record.grading.totalScore || 0) > 0);
  const latest = completed[0] || null;
  const avgAccuracy = average(completed.map((record) => Number(record.grading.accuracy || 0)));
  const avgScoreRate = average(completed.map((record) => rate(record.grading.score, record.grading.totalScore)));
  const manualReviewPending = completed.reduce((sum, record) => sum + Number(record.grading.manualReviewCount || 0), 0);
  const weakPointMap = new Map();

  for (const record of completed) {
    for (const detail of record.grading.details || []) {
      if (detail.status === 'wrong') {
        const key = `${detail.type || '客观题'}第${detail.questionNo || '?'}题`;
        bump(weakPointMap, key, {
          name: key,
          count: 0,
          type: detail.type || '客观题',
          latestPaperId: record.paperId || '',
          latestAssignmentId: record.assignmentId || '',
          reason: `识别答案 ${detail.recognizedAnswer || '空'}，正确答案 ${detail.correctAnswer || '未配置'}`,
        });
      }
      if (detail.status === 'needs_manual_review') {
        const key = `${detail.type || '主观题'}待复核`;
        bump(weakPointMap, key, {
          name: key,
          count: 0,
          type: detail.type || '主观题',
          latestPaperId: record.paperId || '',
          latestAssignmentId: record.assignmentId || '',
          reason: '主观题尚未完成人工/AI 复核',
        });
      }
    }
  }

  const weakPoints = [...weakPointMap.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
  const masteryLevel = avgAccuracy >= 90 ? '优秀' : avgAccuracy >= 80 ? '良好' : avgAccuracy >= 70 ? '待提升' : '需重点干预';
  const riskTags = [];
  if (avgAccuracy && avgAccuracy < 75) riskTags.push('近期正确率偏低');
  if (manualReviewPending > 0) riskTags.push('存在主观题待复核');
  if (weakPoints.length >= 3) riskTags.push('薄弱点较分散');
  if (!completed.length) riskTags.push('暂无可用批改数据');

  const recommendations = buildRecommendations({ avgAccuracy, manualReviewPending, weakPoints });
  const trend = completed.slice(0, 12).reverse().map((record) => ({
    date: String(record.createdAt || '').slice(0, 10),
    uploadId: record.uploadId,
    assignmentId: record.assignmentId || '',
    paperId: record.paperId || '',
    accuracy: Number(record.grading.accuracy || 0),
    score: Number(record.grading.score || 0),
    totalScore: Number(record.grading.totalScore || 0),
    status: record.status || 'graded',
  }));

  return {
    studentId,
    studentName: studentName || latest?.studentName || '',
    generatedAt: new Date().toISOString(),
    source: 'znzy-homework-system',
    summary: {
      totalAssignments: completed.length,
      latestAccuracy: latest ? Number(latest.grading.accuracy || 0) : 0,
      averageAccuracy: avgAccuracy,
      averageScoreRate: avgScoreRate,
      latestScore: latest ? Number(latest.grading.score || 0) : 0,
      latestTotalScore: latest ? Number(latest.grading.totalScore || 0) : 0,
      manualReviewPending,
      masteryLevel,
    },
    weakPoints,
    trend,
    riskTags,
    recommendations,
    volunteerProfile: {
      academicSignal: masteryLevel,
      scienceReadinessScore: Math.round(avgScoreRate || avgAccuracy || 0),
      riskTags,
      focusAreas: weakPoints.slice(0, 5).map((item) => item.name),
      suggestedActions: recommendations.map((item) => item.action),
    },
  };
}

function bump(map, key, seed) {
  const current = map.get(key) || seed;
  current.count += 1;
  map.set(key, current);
}

function average(values) {
  const nums = values.filter((value) => Number.isFinite(value));
  if (!nums.length) return 0;
  return Math.round(nums.reduce((sum, value) => sum + value, 0) / nums.length);
}

function rate(score, totalScore) {
  const total = Number(totalScore || 0);
  if (!total) return 0;
  return Math.round((Number(score || 0) / total) * 100);
}

function buildRecommendations({ avgAccuracy, manualReviewPending, weakPoints }) {
  const list = [];
  if (manualReviewPending > 0) {
    list.push({
      priority: 'high',
      action: '优先完成主观题复核',
      reason: '主观题分数会影响最终学情画像和志愿填报侧学业判断。',
    });
  }
  if (weakPoints.length) {
    list.push({
      priority: 'high',
      action: `围绕${weakPoints[0].name}安排错题变式训练`,
      reason: weakPoints[0].reason,
    });
  }
  if (avgAccuracy && avgAccuracy < 80) {
    list.push({
      priority: 'medium',
      action: '推送基础概念回顾和限时小题训练',
      reason: '近期平均正确率未达到稳定掌握水平。',
    });
  }
  if (!list.length) {
    list.push({
      priority: 'normal',
      action: '保持当前节奏并增加综合题挑战',
      reason: '近期作业表现稳定，可逐步提高题目综合度。',
    });
  }
  return list;
}

module.exports = { buildStudentProfile };
