/**
 * 志愿填报 / 小程序 web-view 宿主 SDK
 * 用法见 embed/host-demo.html
 */
(function (global) {
  'use strict';

  var DEFAULT_ORIGIN = '*';

  function ZnzyHost(options) {
    this.iframe = null;
    this.options = options || {};
    this.listeners = {};
    this._boundMessage = this._onMessage.bind(this);
  }

  ZnzyHost.prototype.mount = function (container, src) {
    if (typeof container === 'string') {
      container = document.querySelector(container);
    }
    if (!container) throw new Error('容器不存在');

    var iframe = document.createElement('iframe');
    iframe.src = src || this.options.src || '/';
    iframe.title = this.options.title || '智能作业';
    iframe.setAttribute('allow', 'camera; microphone');
    iframe.style.cssText =
      this.options.iframeStyle ||
      'width:100%;height:100%;min-height:480px;border:0;border-radius:12px;background:#fff;';
    container.innerHTML = '';
    container.appendChild(iframe);
    this.iframe = iframe;

    if (!this._listening) {
      window.addEventListener('message', this._boundMessage);
      this._listening = true;
    }
    return this;
  };

  ZnzyHost.prototype.unmount = function () {
    if (this._listening) {
      window.removeEventListener('message', this._boundMessage);
      this._listening = false;
    }
    if (this.iframe && this.iframe.parentNode) {
      this.iframe.parentNode.removeChild(this.iframe);
    }
    this.iframe = null;
  };

  ZnzyHost.prototype.on = function (event, handler) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(handler);
    return this;
  };

  ZnzyHost.prototype.off = function (event, handler) {
    var list = this.listeners[event];
    if (!list) return this;
    this.listeners[event] = handler ? list.filter(function (h) { return h !== handler; }) : [];
    return this;
  };

  ZnzyHost.prototype._emit = function (event, payload) {
    var list = this.listeners[event] || [];
    list.forEach(function (h) {
      try { h(payload); } catch (e) { console.error('[ZnzyHost]', e); }
    });
  };

  ZnzyHost.prototype._onMessage = function (event) {
    var trusted = this.options.trustedOrigins;
    if (Array.isArray(trusted) && trusted.length && trusted.indexOf(event.origin) === -1) {
      return;
    }
    var data = event.data;
    if (!data || typeof data !== 'object' || !data.type) return;

    switch (data.type) {
      case 'ready':
        this._emit('ready', data.payload || {});
        break;
      case 'summary-change':
        this._emit('summaryChange', data.payload || {});
        break;
      case 'homework-graded':
        this._emit('homeworkGraded', data.payload || {});
        break;
      case 'student-profile':
        this._emit('studentProfile', data.payload || {});
        break;
      default:
        this._emit('message', data);
    }
  };

  ZnzyHost.prototype.post = function (message) {
    if (!this.iframe || !this.iframe.contentWindow) {
      throw new Error('iframe 未挂载');
    }
    var target = this.options.targetOrigin || DEFAULT_ORIGIN;
    this.iframe.contentWindow.postMessage(message, target);
    return this;
  };

  /** 向子页发送宿主上下文（学生/班级/来源渠道） */
  ZnzyHost.prototype.setHostContext = function (ctx) {
    return this.post({ type: 'host-context', payload: ctx || {} });
  };

  /** 打开指定学生画像（子页需支持 host-navigate） */
  ZnzyHost.prototype.openStudentProfile = function (studentId) {
    return this.post({ type: 'host-navigate', payload: { view: 'student-profile', studentId: studentId } });
  };

  /** 构建带 query 的嵌入 URL */
  ZnzyHost.buildEmbedUrl = function (base, params) {
    var url = new URL(base, typeof location !== 'undefined' ? location.href : 'http://localhost');
    Object.keys(params || {}).forEach(function (k) {
      if (params[k] != null && params[k] !== '') url.searchParams.set(k, String(params[k]));
    });
    return url.pathname + url.search;
  };

  global.ZnzyHost = ZnzyHost;
})(typeof window !== 'undefined' ? window : global);
