const TEMPLATE_VERSION = '1.0';
const PAGE = { widthMm: 210, heightMm: 297, marginMm: 12 };

function isObjective(type) {
  return type.includes('选') || type.includes('判断');
}

function choiceOptions(type) {
  return type.includes('判断') ? ['√', '×'] : ['A', 'B', 'C', 'D'];
}

function buildAnswerSheetLayout({ paperId, questions = [] }) {
  const groups = [];
  const typeOrder = ['单选题', '多选题', '判断题', '填空题', '解答题'];
  for (const type of typeOrder) {
    const items = questions.filter((q) => q.type === type || q.type.includes(type.replace('题', '')));
    if (items.length) groups.push({ type, items });
  }
  const groupedIds = new Set(groups.flatMap((g) => g.items.map((q) => q.id)));
  const rest = questions.filter((q) => !groupedIds.has(q.id));
  if (rest.length) groups.push({ type: '综合题', items: rest });

  let y = PAGE.marginMm + 8;
  const regions = [];

  const markers = [
    { id: 'tl', x: PAGE.marginMm, y: PAGE.marginMm, widthMm: 8, heightMm: 8 },
    { id: 'tr', x: PAGE.widthMm - PAGE.marginMm - 8, y: PAGE.marginMm, widthMm: 8, heightMm: 8 },
    { id: 'bl', x: PAGE.marginMm, y: PAGE.heightMm - PAGE.marginMm - 8, widthMm: 8, heightMm: 8 },
    { id: 'br', x: PAGE.widthMm - PAGE.marginMm - 8, y: PAGE.heightMm - PAGE.marginMm - 8, widthMm: 8, heightMm: 8 },
  ];

  const qrCode = {
    x: PAGE.widthMm - PAGE.marginMm - 28,
    y: PAGE.marginMm + 10,
    widthMm: 28,
    heightMm: 28,
  };

  y = PAGE.marginMm + 42;

  for (const group of groups) {
    y += 8;
    const objective = group.items.filter((q) => isObjective(q.type));
    const subjective = group.items.filter((q) => !isObjective(q.type));

    for (const q of objective) {
      const options = choiceOptions(q.type);
      const choiceRegions = options.map((option, idx) => ({
        option,
        x: PAGE.marginMm + 18 + idx * 14,
        y,
        widthMm: 10,
        heightMm: 10,
      }));
      regions.push({
        questionNo: q.sortNo ?? q.id,
        questionId: q.id,
        type: q.type.includes('多选') ? 'multi_choice' : q.type.includes('判断') ? 'true_false' : 'single_choice',
        groupType: group.type,
        choiceRegions,
        score: Number(q.score || 0),
      });
      y += 12;
    }

    for (const q of subjective) {
      const boxHeight = q.type.includes('解答') ? 48 : q.type.includes('填空') ? 18 : 32;
      regions.push({
        questionNo: q.sortNo ?? q.id,
        questionId: q.id,
        type: q.type.includes('填空') ? 'fill_blank' : 'subjective',
        groupType: group.type,
        answerBox: {
          x: PAGE.marginMm + 4,
          y,
          widthMm: PAGE.widthMm - PAGE.marginMm * 2 - 8,
          heightMm: boxHeight,
        },
        score: Number(q.score || 0),
      });
      y += boxHeight + 10;
    }
  }

  return {
    paperId,
    templateVersion: TEMPLATE_VERSION,
    pageSize: { widthMm: PAGE.widthMm, heightMm: PAGE.heightMm, marginMm: PAGE.marginMm },
    unit: 'mm',
    markers,
    qrCode,
    regions,
    generatedAt: new Date().toISOString(),
  };
}

module.exports = { buildAnswerSheetLayout, TEMPLATE_VERSION };
