# 志愿填报 / 小程序宿主嵌入 SDK

## 快速体验

启动服务后访问：

- 演示页：`http://localhost:4173/embed/host-demo.html`（Docker 全栈）
- 或开发模式：`http://localhost:5173/embed/host-demo.html`（需 Vite 代理静态资源，生产以 Express `/embed` 为准）

## 集成方式

### 1. H5 / 志愿填报 Web

```html
<div id="homework"></div>
<script src="https://your-domain/embed/znzy-host-sdk.js"></script>
<script>
  var host = new ZnzyHost();
  host.mount('#homework', '/?embed=1&studentId=xxx&classId=yyy');
  host.on('homeworkGraded', function (payload) {
    console.log('批改完成', payload);
  });
  host.on('studentProfile', function (payload) {
    console.log('学情画像', payload);
  });
</script>
```

### 2. 微信小程序 web-view

```xml
<web-view src="{{homeworkUrl}}" bindmessage="onHomeworkMessage"></web-view>
```

子页仍使用 `wx.miniProgram.postMessage`（项目内 `App.tsx` 已封装）；H5 宿主用 `ZnzyHost` 监听同源 `postMessage`。

### 3. 宿主 → 子页消息

| type | 说明 |
|------|------|
| `host-context` | 下发学生/班级/渠道等上下文 |
| `host-navigate` | 请求子页跳转（如 `student-profile`） |

### 4. 子页 → 宿主消息

| type | 说明 |
|------|------|
| `ready` | 子页加载完成 |
| `summary-change` | 作业汇总变化 |
| `homework-graded` | 单次批改完成 |
| `student-profile` | 学情画像数据 |

## 安全建议

生产环境设置 `trustedOrigins: ['https://your-volunteer-app.com']`，并配置 `targetOrigin` 为子页精确 origin。
