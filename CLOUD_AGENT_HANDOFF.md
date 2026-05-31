# Cursor Cloud Agent 接手提示词

请接手当前项目继续开发。

## 项目背景

这是一个面向中小学理科场景的智能作业与学情诊断系统，未来需要嵌入到志愿填报小程序 / 志愿填报系统中，作为学业数据、学情诊断和学生画像模块。

## 当前已实现

1. Vite + React + TypeScript 前端。
2. Node.js + Express 本地 API。
3. DOCX 试卷导入解析，使用 mammoth。
4. 支持复制粘贴导入题库。
5. 支持手动录入题目。
6. 支持题库列表、题型筛选、学科筛选、关键词搜索。
7. 支持题目编辑、删除。
8. 支持服务端 JSON 题库存储。
9. 支持智能组卷接口。
10. 支持标准试卷版、精简练习版、标准答题卡。
11. 支持 A4 打印 / 另存 PDF。
12. 答题卡支持题型分组。
13. 答题卡支持真实二维码，内容包含 `paperId`、`studentId`、`assignmentId`、`templateVersion`。
14. 答题卡支持四角定位点。
15. 答题卡支持坐标映射 Layout JSON，覆盖客观题填涂区和主观题答题框。
16. 已提供拍照上传批改接口，保存原图并返回模拟识别结果。
17. 已实现客观题自动判分，主观题进入待复核队列。
18. 已新增答题卡布局与批改记录持久化，支持 JSON / MySQL。
19. 已新增主观题人工复核接口和前端演示入口，可更新总分、正确率和记录状态。
20. 前端支持 iframe / web-view 嵌入模式，并读取 `studentId`、`studentName`、`assignmentId`、`token`。
21. 已提供 `database-schema.sql` 作为正式 MySQL 数据库结构草案，并新增 MySQL 存储适配。

## 重要文件

- `src/App.tsx`：核心前端逻辑
- `src/styles.css`：UI、打印和答题卡样式
- `server/index.cjs`：本地 API 服务
- `server/answer-sheet.cjs`：二维码、答题卡坐标映射、客观题判分
- `server/question-store.cjs`：JSON / MySQL 题库存储适配
- `server/grading-store.cjs`：答题卡布局和批改记录 JSON / MySQL 存储适配
- `server/data/questions.json`：服务端 JSON 题库
- `database-schema.sql`：正式数据库表结构
- `README.md`：项目说明

## 运行方式

```bash
npm install
npm run dev:all
```

## 当前业务方向

优先做理科科目：

- 数学
- 物理
- 化学
- 生物

题库模板主要根据 Word 文档格式：

```text
一、单选题
【题文】...
【选项A】...
【选项B】...
【选项C】...
【选项D】...
【答案】...
【解析】...
【结束】

二、多选题
三、判断题
四、填空题
五、解答题
```

## 学生画像接口

已新增 `GET /api/students/:studentId/profile` 和 `GET /api/student-profile`，用于向志愿填报系统输出学业画像。画像基于批改记录聚合正确率、薄弱点、待复核风险、推荐动作和 `volunteerProfile` 摘要。

## 下一步任务建议

请优先继续实现：

已完成本轮优先项：真实二维码、Layout JSON、拍照上传批改、客观题自动判分、主观题人工复核演示、小程序参数适配、MySQL 存储适配，并补齐布局/批改记录可查询持久化。

后续建议继续：

1. 图像纠偏与真实 OCR / OMR
   - 使用四角定位点做透视矫正。
   - 接入真实填涂识别模型或第三方 OCR。

2. 主观题 AI 初判 + 人工复核
   - 为解答题保存裁剪图、评分点和复核状态。

3. 文件存储正式化
   - 将 `server/uploads/grading` 替换为 OSS / MinIO。

4. 志愿填报系统画像接口增强
   - 后续可接入考试、课堂表现和选科/专业倾向数据，形成更完整画像。

## 注意事项

- 不要破坏现有前端演示能力。
- 后端不可用时，前端应继续保留 localStorage 兜底。
- 打印样式要持续保证 A4 兼容。
- 答题卡定位点、二维码区、题号区后续会用于拍照识别，不要随意删除。
