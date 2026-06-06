/**
 * 志愿填报小程序 · 智能作业 web-view 宿主页
 *
 * 使用前在小程序后台配置 web-view 业务域名（如 https://your-homework-domain.com）
 * 并将 HOMEWORK_H5_BASE 改为你的 H5 部署地址。
 */
const HOMEWORK_H5_BASE = 'https://your-homework-domain.com';

function buildHomeworkUrl(base, params) {
  const qs = Object.keys(params)
    .filter((k) => params[k])
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
    .join('&');
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}${qs}`;
}

function summarizePayload(type, payload) {
  if (!payload || typeof payload !== 'object') return '';
  if (type === 'homework-graded') {
    return `正确率 ${payload.accuracy}% · 得分 ${payload.score}`;
  }
  if (type === 'student-profile') {
    return `画像 · 批改 ${payload.gradingCount || 0} 次`;
  }
  if (type === 'summary-change') {
    return `作业 ${payload.latestHomeworkAccuracy}% · 考试 ${payload.examAverage}%`;
  }
  return JSON.stringify(payload).slice(0, 120);
}

Page({
  data: {
    studentId: 'stu-demo-001',
    classId: 'class-demo-001',
    homeworkUrl: '',
    messages: [],
  },

  onLoad(options) {
    if (options.studentId) this.setData({ studentId: options.studentId });
    if (options.classId) this.setData({ classId: options.classId });
    this.reloadWebView();
  },

  onStudentIdInput(e) {
    this.setData({ studentId: e.detail.value });
  },

  onClassIdInput(e) {
    this.setData({ classId: e.detail.value });
  },

  reloadWebView() {
    const url = buildHomeworkUrl(HOMEWORK_H5_BASE, {
      embed: '1',
      studentId: this.data.studentId,
      classId: this.data.classId,
      channel: 'volunteer-miniprogram',
    });
    this.setData({ homeworkUrl: url });
  },

  /**
   * web-view 内 H5 通过 wx.miniProgram.postMessage 上报的数据在此接收。
   * 注意：微信会在特定时机（返回、分享、销毁等）批量投递 message。
   */
  onHomeworkMessage(e) {
    const list = (e.detail && e.detail.data) || [];
    const now = new Date().toLocaleTimeString();
    const rows = list.map((item) => {
      const type = item.type || 'unknown';
      const payload = item.payload || item;
      return {
        type,
        time: now,
        summary: summarizePayload(type, payload),
        raw: item,
      };
    });
    this.setData({
      messages: [...rows, ...this.data.messages].slice(0, 30),
    });

    const graded = rows.find((r) => r.type === 'homework-graded');
    if (graded) {
      wx.showToast({ title: '收到批改结果', icon: 'success', duration: 1500 });
    }

    const profile = rows.find((r) => r.type === 'student-profile');
    if (profile) {
      // 可在此写入志愿填报系统的本地缓存或上报后端
      wx.setStorageSync('znzy_last_profile', profile.raw);
    }
  },
});
