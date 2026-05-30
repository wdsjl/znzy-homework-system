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
- 真实二维码答题卡，二维码内容包含 paperId / studentId / assignmentId / templateVersion
- 答题卡四角定位点
- 答题卡坐标映射 Layout JSON（客观题填涂区、主观题答题框）
- 拍照上传批改接口，保存原图并返回模拟填涂识别结果
- 客观题自动判分，主观题进入复核队列
- iframe / 小程序 web-view 嵌入参数适配
- 服务端 JSON 存储，支持通过环境变量切换 MySQL 8.x

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

## 后端接口

- `GET /api/health`
- `GET /api/questions`
- `POST /api/questions`
- `PUT /api/questions/:id`
- `DELETE /api/questions/:id`
- `POST /api/question-import/paste`
- `POST /api/question-import/docx`
- `POST /api/papers/generate`
- `POST /api/answer-sheets/qrcode`
- `POST /api/answer-sheets/layout`
- `POST /api/grading/uploads`
- `GET /api/knowledge-points`

## 嵌入方式

```html
<iframe
  src="/?embed=1&tab=analytics&studentId=S001&studentName=张三&assignmentId=A20260530&token=host-token"
  style="width:100%;height:760px;border:0;"
></iframe>
```

小程序中可通过 `web-view` 承载 H5 页面。页面会读取 `studentId`、`studentName`、`assignmentId`、`token` 参数，并通过 `window.parent.postMessage` 与 `wx.miniProgram.postMessage` 发送 ready、summary-change、assignment-generated、homework-graded 等事件。

## 答题卡与批改

- `POST /api/answer-sheets/layout`：入参包含 `paperId`、`studentId`、`assignmentId`、`templateVersion`、`questions`，返回二维码 DataURL 与 Layout JSON。
- Layout JSON 使用毫米坐标，包含页面尺寸、四角定位点、二维码区域、学生信息区、每题答题区域；客观题包含选项圆心坐标，主观题包含答题框坐标。
- `POST /api/grading/uploads`：使用 multipart/form-data 上传 `file`，可附带 `questions`、`answerSheetLayout`、`studentId`、`studentName`、`assignmentId`、`paperId`；接口保存原图到 `server/uploads/grading`，返回模拟填涂识别、客观题判分、错题列表与主观题待复核数量。

## MySQL 存储切换

默认仍使用 `server/data/questions.json`，保证本地演示可用。需要切换到 MySQL 时先执行 `database-schema.sql`，再配置：

```bash
STORAGE_DRIVER=mysql
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=your-password
MYSQL_DATABASE=learning_diagnosis
```

也可以使用 `DATABASE_URL`。未配置或 MySQL 不可用时会回退到 JSON；若需要严格失败，设置 `STORAGE_STRICT=1`。

## 下一步建议

- 图像纠偏与真实 OCR / OMR 识别
- 主观题 AI 初判 + 人工复核
- OSS / MinIO 文件存储替换本地上传目录
- 志愿填报系统学生画像接口
