# 智能作业与学情诊断系统

面向中小学理科场景的智能作业系统原型，支持题库导入、题库管理、智能组卷、试卷打印、答题卡模板、拍照批改演示和志愿填报系统嵌入。

## 当前能力

- 理科题库方向：数学、物理、化学、生物
- DOCX 试卷导入解析
- 复制粘贴题库导入
- 手动录入题目
- 题库列表、筛选、编辑、删除
- 本地 Node API 服务
- 服务端 JSON 题库存储
- 智能组卷接口
- 标准试卷版、精简练习版、标准答题卡
- A4 打印 / 另存 PDF
- 答题卡题型分组
- 答题卡二维码占位区
- 答题卡四角定位点
- iframe / 小程序 web-view 嵌入基础

## 技术栈

- Frontend: Vite + React + TypeScript
- Backend: Node.js + Express
- Word 解析: mammoth
- 图表: recharts
- 图标: lucide-react

## 安装依赖

```bash
npm install
```

## 启动

只启动前端：

```bash
npm run dev
```

只启动后端 API：

```bash
npm run dev:api
```

前后端一起启动：

```bash
npm run dev:all
```

## 构建

```bash
npm run build
```

## 主要目录

```text
src/
  App.tsx          核心前端界面与交互
  styles.css       页面、打印、答题卡样式
server/
  index.cjs        本地 API 服务
  data/questions.json  服务端题库 JSON 数据
database-schema.sql    正式 MySQL 数据库表结构草案
```

## 数据库

默认使用 `server/data/*.json` 本地存储。配置 MySQL 后自动切换：

```bash
cp .env.example .env
npm run db:up          # Docker 启动 MySQL
# DATABASE_URL=mysql://znzy:znzy@127.0.0.1:3306/znzy_homework
npm run db:seed        # 首次导入 questions.json
npm run dev:all
```

运行时表结构见 `server/sql/init-runtime.sql`（与 `database-schema.sql` 正式版可并行演进）。

启用正式 schema：

```bash
USE_FORMAL_SCHEMA=1 npm run db:up
USE_FORMAL_SCHEMA=1 npm run db:seed
```

## LLM 语义判分

配置 `LLM_API_KEY` 后，解答题及低相似度主观题会调用 OpenAI 兼容接口进行语义判分；未配置时自动使用模糊相似度算法。

## 后端接口

- `GET /api/health`
- `GET /api/questions`
- `POST /api/questions`
- `PUT /api/questions/:id`
- `DELETE /api/questions/:id`
- `POST /api/question-import/paste`
- `POST /api/question-import/docx`
- `POST /api/papers/generate`
- `GET /api/papers/:id`
- `GET /api/papers/:id/answer-sheet-layout`
- `GET /api/papers/:id/qr`
- `POST /api/grading/upload`
- `GET /api/grading`
- `GET /api/grading/:id`
- `POST /api/grading/:id/review`
- `GET /api/knowledge-points`

## 嵌入方式

```html
<iframe
  src="/?embed=1&tab=analytics&studentName=张三&studentId=s001&assignmentId=a001&token=xxx"
  style="width:100%;height:760px;border:0;"
></iframe>
```

支持 URL 参数：`studentId`、`studentName`、`assignmentId`、`token`。页面会通过 `postMessage` 向宿主系统发送 `ready`、`summary-change`、`homework-graded` 等事件。

小程序中可通过 `web-view` 承载 H5 页面。

## 下一步建议

- 真实二维码生成（答题卡含 paperId / studentId / assignmentId）
- 答题卡坐标映射 JSON
- 拍照上传、图像纠偏、填涂检测与 Tesseract OCR 判分
- MySQL 存储（未配置时 JSON 兜底）
- 主观题 AI 初判 + 人工复核
- 接入 MySQL / PostgreSQL
- 接入 OSS / MinIO 文件存储
- 志愿填报系统学生画像接口
