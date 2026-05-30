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
13. 答题卡支持二维码占位区。
14. 答题卡支持四角定位点。
15. 前端支持 iframe / web-view 嵌入模式。
16. 已提供 `database-schema.sql` 作为正式 MySQL 数据库结构草案。

## 重要文件

- `src/App.tsx`：核心前端逻辑
- `src/styles.css`：UI、打印和答题卡样式
- `server/index.cjs`：本地 API 服务
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

## 下一步任务建议

请优先继续实现：

1. 真实二维码生成
   - 为答题卡生成真实二维码。
   - 二维码内容包括：`paperId`、`studentId`、`assignmentId`、`templateVersion`。

2. 答题卡坐标映射
   - 为每个题号生成坐标区域。
   - 输出 answer sheet layout JSON。
   - 支持客观题填涂区和主观题答题框坐标。

3. 拍照上传批改接口
   - 上传答题卡图片。
   - 保存原图。
   - 返回模拟 OCR / 填涂识别结果。
   - 根据题目答案自动判分。

4. 正式数据库接入
   - 用 `database-schema.sql` 建表。
   - 将 `server/data/questions.json` 替换成 MySQL / PostgreSQL。

5. 小程序 web-view 嵌入适配
   - 支持 URL 参数：`studentId`、`studentName`、`assignmentId`、`token`。
   - 支持向宿主系统发送 `postMessage` 事件。

## 注意事项

- 不要破坏现有前端演示能力。
- 后端不可用时，前端应继续保留 localStorage 兜底。
- 打印样式要持续保证 A4 兼容。
- 答题卡定位点、二维码区、题号区后续会用于拍照识别，不要随意删除。
