# 微信小程序 web-view 集成示例

将 `pages/homework/` 复制到你的志愿填报小程序项目中，并在 `app.json` 注册页面路径。

## 1. 配置业务域名

在微信公众平台 → 开发 → 开发管理 → 开发设置 → **业务域名**，添加智能作业 H5 部署域名（必须 HTTPS）。

## 2. 修改 H5 地址

编辑 `homework.js`：

```javascript
const HOMEWORK_H5_BASE = 'https://your-homework-domain.com';
```

开发阶段可在开发者工具中勾选「不校验合法域名」。

## 3. 页面结构

```xml
<web-view src="{{homeworkUrl}}" bindmessage="onHomeworkMessage"></web-view>
```

URL 参数建议：

| 参数 | 说明 |
|------|------|
| `embed=1` | 嵌入模式（隐藏侧栏） |
| `studentId` | 学生 ID |
| `classId` | 班级 ID |
| `channel` | 来源渠道标识 |

## 4. 子页 → 小程序消息

H5 子页（`App.tsx`）在关键节点调用 `wx.miniProgram.postMessage`：

- `ready` — 页面就绪
- `summary-change` — 学情摘要变化
- `homework-graded` — 批改完成
- `student-profile` — 学生画像

小程序在 `bindmessage="onHomeworkMessage"` 中接收。**消息会在返回、分享、组件销毁等时机批量投递**，不是逐条实时推送；如需实时同步，请配合后端 Webhook 或轮询 API。

## 5. 与后端 API 联动

小程序宿主可直接调用同一套 API（需配置 request 合法域名）：

```
GET  /api/students/:studentId/profile
GET  /api/grading/jobs/:jobId
POST /api/grading/upload?async=1
```

## 6. 本地联调

1. `npm run dev:all` 启动 H5 + API
2. 使用内网穿透（ngrok / frp）暴露 HTTPS 地址给小程序
3. 或将 H5 部署到测试域名后在开发者工具打开 `pages/homework/homework`

## 7. H5 宿主演示（非小程序）

浏览器宿主请使用 `../host-demo.html` + `znzy-host-sdk.js`，支持 iframe 双向 `postMessage`。
