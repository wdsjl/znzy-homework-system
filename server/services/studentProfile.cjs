function aggregateWeakPoints(gradings) {
  const map = new Map();
  for (const g of gradings) {
    for (const point of g.wrongPoints || []) {
      map.set(point, (map.get(point) || 0) + 1);
    }
    for (const d of g.details || []) {
      if (!d.correct || d.reviewSuggested) {
        const label = `${d.type || '题目'}第${d.questionNo}题`;
        map.set(label, (map.get(label) || 0) + 1);
      }
    }
  }
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, count]) => ({ name, count }));
}

function aggregateSubjectMastery(gradings, papers = new Map()) {
  const map = new Map();
  for (const g of gradings) {
    const paper = papers.get(g.paperId);
    const subject = paper?.subject || '理科综合';
    if (!map.has(subject)) map.set(subject, { total: 0, earned: 0, count: 0 });
    const row = map.get(subject);
    row.total += Number(g.totalScore || 0);
    row.earned += Number(g.earnedScore || 0);
    row.count += 1;
  }
  return [...map.entries()].map(([subject, row]) => ({
    subject,
    accuracy: row.total ? Math.round((row.earned / row.total) * 100) : 0,
    count: row.count,
  }));
}

function buildRecommendations(weakPoints, subjectMastery) {
  const tips = [];
  if (weakPoints.length) {
    tips.push(`优先巩固：${weakPoints.slice(0, 3).map((x) => x.name).join('、')}`);
  }
  const low = subjectMastery.filter((s) => s.accuracy < 75).sort((a, b) => a.accuracy - b.accuracy);
  if (low.length) {
    tips.push(`${low[0].subject} 建议安排 3-5 题专项训练（当前约 ${low[0].accuracy}%）`);
  }
  if (!tips.length) tips.push('整体表现稳定，可适度增加综合挑战题。');
  return tips;
}

async function buildStudentProfile(store, studentId, { studentName } = {}) {
  const gradings = await store.listGradings({ studentId });
  const papers = new Map();
  for (const g of gradings) {
    if (!papers.has(g.paperId)) {
      try {
        const paper = await store.getPaper(g.paperId);
        if (paper) papers.set(g.paperId, paper);
      } catch {
        /* paper may have been removed */
      }
    }
  }

  const totalGradings = gradings.length;
  const earned = gradings.reduce((s, g) => s + Number(g.earnedScore || 0), 0);
  const total = gradings.reduce((s, g) => s + Number(g.totalScore || 0), 0);
  const homeworkAccuracy = total ? Math.round((earned / total) * 100) : 0;
  const needsReviewCount = gradings.filter((g) => (g.needsReview || 0) > 0 || g.reviewStatus === 'pending').length;
  const weakPoints = aggregateWeakPoints(gradings);
  const subjectMastery = aggregateSubjectMastery(gradings, papers);
  const recentGradings = gradings.slice(0, 5).map((g) => ({
    id: g.id,
    paperId: g.paperId,
    accuracy: g.accuracy,
    earnedScore: g.earnedScore,
    totalScore: g.totalScore,
    mode: g.mode,
    reviewStatus: g.reviewStatus,
    gradedAt: g.gradedAt,
  }));

  return {
    studentId,
    studentName: studentName || studentId,
    generatedAt: new Date().toISOString(),
    summary: {
      homeworkAccuracy,
      totalGradings,
      needsReviewCount,
      latestAccuracy: gradings[0]?.accuracy ?? null,
      avgEarnedScore: totalGradings ? Math.round(earned / totalGradings) : 0,
    },
    weakPoints,
    subjectMastery,
    recentGradings,
    recommendations: buildRecommendations(weakPoints, subjectMastery),
    embedHints: {
      postMessageType: 'student-profile',
      suitableFor: 'volunteer-admission-widget',
    },
  };
}

module.exports = { buildStudentProfile, aggregateWeakPoints, aggregateSubjectMastery };
