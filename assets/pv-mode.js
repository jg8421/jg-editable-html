/* =====================================================================
   pv-mode v1.0 · 「阅读 / 编辑」模式开关 + 浮动按钮常驻兜底
   ─────────────────────────────────────────────────────────────────────
   由 pv-editable-html 的 build_panel.py 自动注入，零依赖、零配置。
   页面上会多出右上角一个「阅读 | 编辑」两段式开关：

   · 阅读模式（默认）：没有 hover 描边、没有选中高亮、编辑器工具条全部收起；
     顶部导航 / 分页器 / 折叠面板等控件可以正常点击。
   · 编辑模式：pv-anyedit（任意元素编辑）与就地编辑全部打开，等同旧版默认状态。
   · 选择记忆在 localStorage；不可用时（某些 file:// 环境）每次打开都是阅读模式。
   · 浮动按钮常驻兜底：若页面被放进带 transform / filter 的容器（iframe 预览器、
     内置浏览器），position:fixed 会失效、按钮会"沉"到文档末尾 —— 这里检测到后
     自动改成 absolute + 跟随滚动钉住，保证「保存」始终在屏幕里。

   对外 API：window.PVMode = { read(), edit(), toggle(), isRead() }
   ===================================================================== */
(function () {
  "use strict";

  var MODE_KEY = "pv-mode::" + (location.pathname || "");
  var FLOATS = [["#pvanyedit-ui .pae-save", 52], [".pae-toggle", 94], [".pae-auth", 134]];
  var read = true;      /* 默认阅读模式 */
  var broken = false;   /* fixed 失效标记：只判定一次然后锁存，避免抖动 */
  var btn = null;
  var settled = false;

  var CSS = [
    /* ---- 右上角模式开关 ---- */
    "#pv-mode-btn{position:fixed;top:7px;right:12px;z-index:2147483200;display:inline-flex;align-items:center;gap:2px;",
    "padding:3px;border-radius:16px;border:1px solid #c9ced3;background:#fff;box-shadow:0 3px 12px rgba(9,44,97,.20);",
    "font:600 12.5px/1 \"Microsoft YaHei\",\"PingFang SC\",Arial,sans-serif;user-select:none}",
    "#pv-mode-btn .seg{padding:5px 12px;border-radius:13px;color:#5b7089;cursor:pointer;white-space:nowrap}",
    "#pv-mode-btn .seg:hover{color:#1c7ed6}",
    "#pv-mode-btn .seg.on{background:#092C61;color:#fff}",
    "#pv-mode-btn[data-mode=\"edit\"] .seg.on{background:#159788;color:#fff}",
    /* 顶部导航右端留位，别被开关压住最后一个 tab */
    "nav{padding-right:126px!important}",
    /* ---- 浮动按钮：保存常驻右下角（页面很长时的唯一保存入口） ---- */
    ".pae-save{position:fixed!important;right:16px!important;bottom:52px!important;z-index:2147483001!important;",
    "background:#159788!important;border-color:#159788!important;color:#fff!important;",
    "padding:7px 15px!important;font-size:13px!important;font-weight:700!important;",
    "box-shadow:0 5px 18px rgba(9,44,97,.30)!important}",
    ".pae-toggle{position:fixed!important;right:16px!important;bottom:94px!important}",
    ".pae-auth{position:fixed!important;right:16px!important;bottom:134px!important}",
    "@media print{#pv-mode-btn,.pae-save,.pae-toggle,.pae-auth{display:none!important}}",
    /* ---- 阅读模式：编辑相关的视觉与控件一律收起 ---- */
    "html.pv-read .pae-hl,html.pv-read .pae-hl2{outline:none!important}",
    "html.pv-read [data-pae-sel]{filter:none!important}",
    "html.pv-read .pae-toolbar,html.pv-read .pae-drop,html.pv-read .pae-fs{display:none!important}",
    "html.pv-read .pae-toggle,html.pv-read .pae-auth{display:none!important}",
    "html.pv-read #pvnt-editbar,html.pv-read #pvnt-ribbon,html.pv-read #pvnt-srcwrap{display:none!important}",
    "html.pv-read [contenteditable=\"true\"]{outline:none!important;background:transparent!important}"
  ].join("");

  function injectCss() {
    if (document.getElementById("pv-mode-css")) return;
    var st = document.createElement("style");
    st.id = "pv-mode-css";
    st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  /* ---------- 浮动按钮常驻（fixed 失效时兜底） ---------- */
  function floats() {
    var out = [], i, e;
    for (i = 0; i < FLOATS.length; i++) {
      e = document.querySelector(FLOATS[i][0]);
      if (e) out.push([e, FLOATS[i][1]]);
    }
    return out;
  }
  function pin() {
    var ls = floats();
    if (!ls.length) return;
    if (!broken) {
      var r = ls[0][0].getBoundingClientRect();
      /* 正常 fixed：底边应当 ≈ innerHeight - offset。差得远 = fixed 被容器吃掉了 */
      if (Math.abs(r.bottom - (window.innerHeight - ls[0][1])) <= 60) return;
      broken = true;
    }
    var ui = document.getElementById("pvanyedit-ui");
    if (ui) {
      ui.style.setProperty("position", "absolute", "important");
      ui.style.setProperty("left", "0", "important");
      ui.style.setProperty("top", "0", "important");
      ui.style.setProperty("width", "100%", "important");
      ui.style.setProperty("height", "0", "important");
      ui.style.setProperty("right", "auto", "important");
      ui.style.setProperty("bottom", "auto", "important");
    }
    var y = (window.pageYOffset || document.documentElement.scrollTop || 0) + window.innerHeight;
    var ls2 = floats(), i, e, h;
    for (i = 0; i < ls2.length; i++) {
      e = ls2[i][0];
      h = e.offsetHeight || 28;
      /* 我们的 CSS 用了 !important 做默认钉住，这里必须同样用 important 的内联样式才压得住 */
      e.style.setProperty("position", "absolute", "important");
      e.style.setProperty("right", "16px", "important");
      e.style.setProperty("bottom", "auto", "important");
      e.style.setProperty("top", (y - ls2[i][1] - h) + "px", "important");
      e.style.setProperty("z-index", "2147483001", "important");
    }
  }

  /* ---------- 模式切换 ---------- */
  function sync() {
    if (btn) {
      btn.setAttribute("data-mode", read ? "read" : "edit");
      var segs = btn.querySelectorAll(".seg");
      for (var i = 0; i < segs.length; i++) {
        if (segs[i].getAttribute("data-mode") === (read ? "read" : "edit")) segs[i].classList.add("on");
        else segs[i].classList.remove("on");
      }
    }
    document.documentElement.classList.toggle("pv-read", read);
  }
  function applyMode(next, remember) {
    read = !!next;
    try { if (window.PVAnyEdit) { read ? window.PVAnyEdit.off() : window.PVAnyEdit.on(); } } catch (e) { }
    try { if (window.PVNT_EDIT && window.PVNT_EDIT.set) window.PVNT_EDIT.set(!read); } catch (e) { }
    if (remember !== false) { try { localStorage.setItem(MODE_KEY, read ? "read" : "edit"); } catch (e) { } }
    sync();
    pin();
  }

  function buildBtn() {
    if (btn || !document.body) return;
    btn = document.createElement("div");
    btn.id = "pv-mode-btn";
    btn.setAttribute("role", "switch");
    btn.title = "阅读模式：无 hover 描边、导航可正常点击；编辑模式：可改文字 / 调样式 / 删元素";
    btn.innerHTML = '<span class="seg" data-mode="read">阅读</span><span class="seg" data-mode="edit">编辑</span>';
    var segs = btn.querySelectorAll(".seg");
    for (var i = 0; i < segs.length; i++) {
      (function (s) {
        s.addEventListener("click", function (ev) {
          ev.preventDefault();
          ev.stopPropagation();
          applyMode(s.getAttribute("data-mode") !== "edit");
        });
      })(segs[i]);
    }
    document.body.appendChild(btn);
  }

  function boot() {
    injectCss();
    buildBtn();
    var saved = null;
    try { saved = localStorage.getItem(MODE_KEY); } catch (e) { }
    applyMode(saved === "edit" ? false : true);
    window.addEventListener("scroll", pin, { passive: true });
    window.addEventListener("resize", pin);
    var n = 0, iv = setInterval(function () {
      if (!settled && window.PVAnyEdit && window.PVNT_EDIT) { settled = true; applyMode(read, false); }
      sync(); pin();
      if (++n > 40) clearInterval(iv);
    }, 300);
    setTimeout(function () { applyMode(read, false); }, 80);
    setTimeout(function () { applyMode(read, false); }, 700);
    setTimeout(function () { applyMode(read, false); pin(); }, 2000);
  }

  window.PVMode = {
    read: function () { applyMode(true); },
    edit: function () { applyMode(false); },
    toggle: function () { applyMode(read ? false : true); },
    isRead: function () { return read; }
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, false);
  else boot();
})();
