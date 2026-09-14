/* =====================================================================
   pv-notes v1.0  ·  单文件 HTML 「批注 + 就地编辑 + 保存回文件」注入层
   适用：本仓库 研究面板（单文件 / 离线 / 零依赖 / file:// 可开）
   注入：inject_pvnotes.py 把本文件整体塞进目标 HTML 的 </body> 之前
   数据：批注与修改存在本文件内的 <script id="pv-notes-data"> 里，跟着文件走
   ===================================================================== */
(function () {
"use strict";
if (window.__PV_NOTES__) { return; }
window.__PV_NOTES__ = "1.0";

var DATA_ID = "pv-notes-data";
var ROOT_ID = "pvnt-root";
var LS_KEY  = "pvnotes::" + (location.pathname || "local");
var HL_ALL  = "pvnt-note";
var HL_ACT  = "pvnt-act";

var S = { author: "", savedAt: 0, notes: [], edits: [] };
var fileHandle = null;
var selAnchor = null;
var editCtx = null;
var toastTimer = null;
var saveTimer = null;
var dirty = false;
var root = null;
var activeId = "";

/* ------------------------------------------------------------------ 工具 */
function now(){ return Date.now(); }
function uid(){ return "n" + now().toString(36) + Math.random().toString(36).slice(2, 6); }
function esc(s){ return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function nrm(s){ return String(s == null ? "" : s).replace(/\s+/g, " ").trim(); }
function pad2(n){ return (n < 10 ? "0" : "") + n; }
function fmtShort(t){ var d = new Date(t || now()); return (d.getMonth() + 1) + "-" + pad2(d.getDate()) + " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes()); }
function fmtFull(t){ var d = new Date(t || now()); return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) + " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds()); }
function q1(s, r){ return (r || document).querySelector(s); }
function qa(s, r){ return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
function inRoot(n){ while (n) { if (n.id === ROOT_ID) { return true; } n = n.parentNode; } return false; }
function stamp(){ var d = new Date(); return "" + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + "-" + pad2(d.getHours()) + pad2(d.getMinutes()); }

/* -------------------------------------------------------- 文本节点与锚点 */
var SKIP_TAG = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEXTAREA: 1, INPUT: 1, SELECT: 1 };
function textNodes(scope){
  var out = [], w, n;
  if (!scope) { return out; }
  w = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, null);
  while ((n = w.nextNode())) {
    if (SKIP_TAG[n.parentNode.nodeName]) { continue; }
    if (inRoot(n)) { continue; }
    if (!n.nodeValue) { continue; }
    out.push(n);
  }
  return out;
}
function joinText(tn){ var a = [], i; for (i = 0; i < tn.length; i++) { a.push(tn[i].nodeValue); } return a.join(""); }
function holderOf(node){
  var n = (node && node.nodeType === 1) ? node : (node ? node.parentNode : null);
  while (n && n !== document.body && n !== document.documentElement) {
    if (n.id && !inRoot(n)) { return n; }
    n = n.parentNode;
  }
  return document.body;
}
function labelOf(el){
  var s = el;
  while (s && s !== document.body && s.tagName !== "SECTION") { s = s.parentNode; }
  var sec = (s && s !== document.body) ? s : null;
  if (sec && sec.id) {
    var nb = null;
    try { nb = document.querySelector('[data-tab="' + sec.id + '"]'); } catch (e) { nb = null; }
    if (nb) { var nt = nrm(nb.textContent); if (nt) { return nt.slice(0, 40); } }
  }
  var host = sec || el;
  var h = host.querySelector ? host.querySelector("h1,h2,h3,h4,.sec-title,.stitle,.card-h") : null;
  var t = h ? nrm(h.textContent) : "";
  if (!t) { t = (host && host.id) || ""; }
  return t.slice(0, 48);
}
function posAt(tn, pos){
  var acc = 0, i, L;
  for (i = 0; i < tn.length; i++) {
    L = tn[i].nodeValue.length;
    if (pos < acc + L) { return { node: tn[i], off: pos - acc }; }
    if (pos === acc + L) {
      if (i + 1 < tn.length) { return { node: tn[i + 1], off: 0 }; }
      return { node: tn[i], off: L };
    }
    acc += L;
  }
  if (!tn.length) { return null; }
  i = tn.length - 1;
  return { node: tn[i], off: tn[i].nodeValue.length };
}
function rangeAt(tn, start, len){
  var a = posAt(tn, start), b = posAt(tn, start + len), r;
  if (!a || !b) { return null; }
  try { r = document.createRange(); r.setStart(a.node, a.off); r.setEnd(b.node, b.off); } catch (e) { return null; }
  return r;
}
function pointOf(container, offset){
  if (!container) { return null; }
  if (container.nodeType === 3) { return { node: container, off: offset }; }
  var kids = container.childNodes, i, tn, t;
  for (i = offset; i < kids.length; i++) {
    if (kids[i].nodeType === 3 && kids[i].nodeValue) { return { node: kids[i], off: 0 }; }
    tn = textNodes(kids[i]);
    if (tn.length) { return { node: tn[0], off: 0 }; }
  }
  for (i = offset - 1; i >= 0; i--) {
    if (kids[i].nodeType === 3 && kids[i].nodeValue) { t = kids[i]; return { node: t, off: t.nodeValue.length }; }
    tn = textNodes(kids[i]);
    if (tn.length) { t = tn[tn.length - 1]; return { node: t, off: t.nodeValue.length }; }
  }
  return null;
}
function anchorOfRange(range){
  var p1 = pointOf(range.startContainer, range.startOffset);
  var p2 = pointOf(range.endContainer, range.endOffset);
  if (!p1) { return null; }
  var holder = holderOf(p1.node);
  var tn = textNodes(holder), full = joinText(tn), i, acc = 0, o1 = -1, o2 = -1, len, snip, raw;
  for (i = 0; i < tn.length; i++) {
    if (tn[i] === p1.node) { o1 = acc + p1.off; }
    if (p2 && tn[i] === p2.node) { o2 = acc + p2.off; }
    acc += tn[i].nodeValue.length;
  }
  if (o1 < 0) { return null; }
  raw = String(range.toString() || "");
  len = (o2 > o1) ? (o2 - o1) : raw.length;
  snip = full.substr(o1, len);
  if (!nrm(snip)) { snip = raw; len = snip.length; }
  if (!nrm(snip)) { return null; }
  return {
    sec: (holder && holder.id) || "",
    off: o1,
    snippet: snip,
    pre: full.substr(Math.max(0, o1 - 40), Math.min(40, o1)),
    post: full.substr(o1 + snip.length, 40),
    label: labelOf(holder)
  };
}
function locate(a){
  if (!a || !a.snippet) { return null; }
  var scopes = [], h = a.sec ? document.getElementById(a.sec) : null;
  if (h) { scopes.push(h); }
  scopes.push(document.body);
  var i, tn, full, all, p, k, best, bd, d, len = a.snippet.length, target = a.off || 0;
  for (i = 0; i < scopes.length; i++) {
    tn = textNodes(scopes[i]);
    if (!tn.length) { continue; }
    full = joinText(tn);
    all = [];
    p = full.indexOf(a.snippet);
    while (p >= 0 && all.length < 300) { all.push(p); p = full.indexOf(a.snippet, p + 1); }
    if (!all.length) { continue; }
    best = all[0]; bd = Math.abs(all[0] - target);
    for (k = 1; k < all.length; k++) { d = Math.abs(all[k] - target); if (d < bd) { bd = d; best = all[k]; } }
    if (a.pre) {
      for (k = 0; k < all.length; k++) {
        if (full.substr(all[k] - a.pre.length, a.pre.length) === a.pre) { best = all[k]; break; }
      }
    }
    return rangeAt(tn, best, len);
  }
  return null;
}
function leafOf(range){
  var n = range.startContainer;
  if (n && n.nodeType === 3) { return n.parentNode; }
  return n;
}
function refreshLoc(){
  var i;
  for (i = 0; i < S.notes.length; i++) { S.notes[i]._r = locate(S.notes[i]); }
}
function renderHighlights(){
  if (!(window.CSS && CSS.highlights && window.Highlight)) { return; }
  try {
    CSS.highlights.delete(HL_ALL);
    CSS.highlights.delete(HL_ACT);
    var ha = new Highlight(), hc = new Highlight(), i, r;
    for (i = 0; i < S.notes.length; i++) {
      r = S.notes[i]._r || locate(S.notes[i]);
      if (r) { ha.add(r); if (S.notes[i].id === activeId) { hc.add(r); } }
    }
    CSS.highlights.set(HL_ALL, ha);
    CSS.highlights.set(HL_ACT, hc);
  } catch (e) { }
}


/* -------------------------------------------------------------- 状态存取 */
function userBusy(){ return (typeof editCtx !== "undefined") && !!editCtx; }
function markDirty(){ dirty = true; if (saveTimer) { clearTimeout(saveTimer); } saveTimer = setTimeout(function(){ saveTimer = null; saveLocal(); }, 400); updateSaveState(); }
function saveLocal(){
  try {
    S.savedAt = S.savedAt || now();
    localStorage.setItem(LS_KEY, JSON.stringify(S));
  } catch (e) { }
}
function sanitize(st){
  var out = { author: (st && st.author) || "", savedAt: (st && st.savedAt) || 0, notes: [], edits: [], frozen: [] };
  var i, n;
  if (st && st.frozen && st.frozen.length) {
    for (i = 0; i < st.frozen.length; i++) {
      var f = st.frozen[i];
      if (!f || !f.id || typeof f.html !== "string") { continue; }
      out.frozen.push({ id: String(f.id), html: f.html, ts: f.ts || 0 });
    }
  }
  if (st && st.notes && st.notes.length) {
    for (i = 0; i < st.notes.length; i++) {
      n = st.notes[i];
      if (!n || !n.snippet || !n.text) { continue; }
      out.notes.push({
        id: n.id || uid(), sec: n.sec || "", off: n.off || 0, snippet: n.snippet,
        pre: n.pre || "", post: n.post || "", label: n.label || "",
        text: String(n.text), author: n.author || "匿名", ts: n.ts || now(),
        status: n.status === "done" ? "done" : "open"
      });
    }
  }
  if (st && st.edits && st.edits.length) {
    for (i = 0; i < st.edits.length; i++) {
      var e = st.edits[i];
      if (!e || !e.old || !e.next) { continue; }
      out.edits.push({ id: e.id || uid(), a: e.a || null, a2: e.a2 || null, old: String(e.old), next: String(e.next), author: e.author || "匿名", ts: e.ts || now() });
    }
  }
  return out;
}
function mergeStates(base, newer){
  var out = sanitize(base), nw = sanitize(newer), i, j, found;
  for (i = 0; i < nw.notes.length; i++) {
    found = -1;
    for (j = 0; j < out.notes.length; j++) { if (out.notes[j].id === nw.notes[i].id) { found = j; break; } }
    if (found < 0) { out.notes.push(nw.notes[i]); }
    else if ((nw.notes[i].ts || 0) > (out.notes[found].ts || 0)) { out.notes[found] = nw.notes[i]; }
  }
  for (i = 0; i < nw.edits.length; i++) {
    found = -1;
    for (j = 0; j < out.edits.length; j++) { if (out.edits[j].id === nw.edits[i].id) { found = j; break; } }
    if (found < 0) { out.edits.push(nw.edits[i]); }
  }
  for (i = 0; i < nw.frozen.length; i++) {
    found = -1;
    for (j = 0; j < out.frozen.length; j++) { if (out.frozen[j].id === nw.frozen[i].id) { found = j; break; } }
    if (found < 0) { out.frozen.push(nw.frozen[i]); }
    else if ((nw.frozen[i].ts || 0) >= (out.frozen[found].ts || 0)) { out.frozen[found] = nw.frozen[i]; }
  }
  if (nw.author) { out.author = nw.author; }
  out.savedAt = Math.max(out.savedAt || 0, nw.savedAt || 0);
  return out;
}
/* ---- 冻结区：面板重新渲染也不许覆盖用户改过的区域 ---- */
var watchCount = {};
function watchFrozen(el, html){
  if (!el || !window.MutationObserver) { return; }
  if (el.__pvntMo) { try { el.__pvntMo.disconnect(); } catch (e) { } }
  var key = el.id, timer = null, dead = false;
  watchCount[key] = 0;
  var mo = new MutationObserver(function(){
    if (dead) { return; }
    if (typeof userBusy === "function" && userBusy()) { return; }
    if (el.innerHTML === html) { return; }
    if (watchCount[key] > 8) {
      dead = true;
      try { mo.disconnect(); } catch (e) { }
      toast("「" + key + "」被面板持续重绘，已停止自动保护（你的改动仍在文件里）");
      return;
    }
    if (timer) { return; }
    timer = setTimeout(function(){
      timer = null;
      if (dead) { return; }
      if (typeof userBusy === "function" && userBusy()) { return; }
      watchCount[key]++;
      el.innerHTML = html;
    }, 60);
  });
  try { mo.observe(el, { childList: true, subtree: true, characterData: true }); el.__pvntMo = mo; } catch (e) { }
}
function applyFrozen(){
  var i, f, el;
  for (i = 0; i < S.frozen.length; i++) {
    f = S.frozen[i];
    el = document.getElementById(f.id);
    if (!el) { continue; }
    if (el.innerHTML !== f.html) { el.innerHTML = f.html; }
    watchFrozen(el, f.html);
  }
}
function load(){
  var emb = null, sto = null, t, el = document.getElementById(DATA_ID);
  if (el) { try { emb = sanitize(JSON.parse(el.textContent || el.innerText || "")); } catch (e) { } }
  try { t = localStorage.getItem(LS_KEY); if (t) { sto = sanitize(JSON.parse(t)); } } catch (e) { }
  if (emb && sto) { S = ((sto.savedAt || 0) >= (emb.savedAt || 0)) ? mergeStates(emb, sto) : mergeStates(sto, emb); }
  else { S = emb || sto || S; }
  if (!S.author) { try { S.author = localStorage.getItem(LS_KEY + "::author") || ""; } catch (e) { } }
  dirty = false;
}
function reapplyEdits(){
  var i, e, r, p;
  for (i = 0; i < S.edits.length; i++) {
    e = S.edits[i];
    r = locate(e.a2 || e.a);
    if (!r) { continue; }
    p = leafOf(r);
    if (!p || p.nodeType !== 1) { continue; }
    if (p.children && p.children.length) { continue; }
    var cur = nrm(p.textContent);
    if (cur === nrm(e.next)) { /* 已经是改后的样子，无需重放 */ }
    else if (cur === nrm(e.old)) { p.textContent = e.next; }
    else { continue; }
    p.classList.add("pvnt-edited");
    p.setAttribute("data-pvnt-edit", "1");
  }
}

/* ------------------------------------------------------------------ 快照 */
function snapshot(){
  return { pvnotes: "1.0", author: S.author, savedAt: now(), notes: S.notes, edits: S.edits };
}
function baseName(){
  var t = nrm(document.title || "panel").replace(/[\\\/:*?"<>|]/g, "_").slice(0, 60);
  return t || "panel";
}
function buildOutput(){
  var st = snapshot();
  var clone = document.documentElement.cloneNode(true);
  var junk = clone.querySelector("#" + ROOT_ID);
  if (junk && junk.parentNode) { junk.parentNode.removeChild(junk); }
  var d = clone.querySelector("#" + DATA_ID);
  if (!d) {
    d = document.createElement("script");
    d.setAttribute("type", "application/json");
    d.setAttribute("id", DATA_ID);
    (clone.querySelector("body") || clone).appendChild(d);
  }
  d.textContent = JSON.stringify(st);
  return "<!doctype html>" + String.fromCharCode(10) + clone.outerHTML;
}
function downloadText(text, name, mime){
  var blob = new Blob([text], { type: (mime || "text/plain") + ";charset=utf-8" });
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(function(){ try { URL.revokeObjectURL(url); a.parentNode.removeChild(a); } catch (e) { } }, 2000);
}
/* ---- 文件句柄：内存 -> IndexedDB（跨会话记住） -> 首次弹一次选择框 ---- */
function currentFileName(){
  try { return decodeURIComponent((location.pathname || "").split("/").pop() || ""); } catch (e) { return ""; }
}
function fileKey(){ return (location.href || "").split("#")[0]; }
function idbOpen(){
  return new Promise(function(res, rej){
    if (!window.indexedDB) { rej(new Error("no indexedDB")); return; }
    var rq = indexedDB.open("pvnotes", 1);
    rq.onupgradeneeded = function(){ try { rq.result.createObjectStore("h", { keyPath: "k" }); } catch (e) { } };
    rq.onsuccess = function(){ res(rq.result); };
    rq.onerror = function(){ rej(rq.error || new Error("idb open failed")); };
    setTimeout(function(){ rej(new Error("idb timeout")); }, 1500);
  });
}
function idbPut(k, v){
  return idbOpen().then(function(db){
    return new Promise(function(res){
      try {
        var t = db.transaction("h", "readwrite");
        t.objectStore("h").put({ k: k, v: v, ts: now() });
        t.oncomplete = function(){ res(1); };
        t.onerror = function(){ res(0); };
        t.onabort = function(){ res(0); };
      } catch (e) { res(0); }
    });
  }).catch(function(){ return 0; });
}
function idbGet(k){
  return idbOpen().then(function(db){
    return new Promise(function(res){
      try {
        var t = db.transaction("h", "readonly");
        var rq = t.objectStore("h").get(k);
        rq.onsuccess = function(){ res(rq.result ? rq.result.v : null); };
        rq.onerror = function(){ res(null); };
      } catch (e) { res(null); }
    });
  }).catch(function(){ return null; });
}
function pickHandle(){
  if (!window.showSaveFilePicker) { return Promise.resolve(null); }
  return window.showSaveFilePicker({
    suggestedName: currentFileName() || (baseName() + ".html"),
    types: [{ description: "HTML 文件", accept: { "text/html": [".html"] } }]
  }).then(function(h){
    fileHandle = h;
    idbPut(fileKey(), h);
    updateSaveState();
    return h;
  });
}
var handleResolved = false;
function resolveHandle(force){
  if (fileHandle) { return Promise.resolve(fileHandle); }
  if (handleResolved && !force) { return Promise.resolve(null); }
  return idbGet(fileKey()).then(function(h){
    handleResolved = true;
    if (h && h.name && h.name === currentFileName() && h.createWritable) {
      fileHandle = h;
      return h;
    }
    return null;
  }, function(){ handleResolved = true; return null; });
}
function ensureWrite(h){
  if (!h || !h.requestPermission) { return Promise.resolve(true); }
  try {
    return Promise.resolve(h.requestPermission({ mode: "readwrite" })).then(function(p){
      return p === "granted";
    }, function(){ return false; });
  } catch (e) { return Promise.resolve(false); }
}
function writeHandle(h, html){
  return h.createWritable().then(function(w){
    return Promise.resolve(w.write(html)).then(function(){ return w.close(); });
  });
}
function markSaved(){
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  dirty = false;
  S.savedAt = now();
  try { localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch (e) { }
  updateSaveState();
  var d = new Date();
  toast("已保存到 " + (fileHandle && fileHandle.name ? fileHandle.name : "文件") + " · " +
    pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds()));
}
var saving = false;
function doSave(){
  if (saving) { toast("正在保存…"); return; }
  var html;
  /* 注意：这里必须走 window.PVAnyEdit.build()（如果装了任意编辑器），不能直接调闭包里的
     buildOutput —— pv-anyedit 只能包住 PVNotes.buildOutput 这个公开属性，包不住闭包，
     否则保存出来的文件会把编辑器自己的 #pvanyedit-ui 一起烘进去（重开后出现两个工具条）。 */
  try { html = (window.PVAnyEdit && typeof window.PVAnyEdit.build === "function") ? window.PVAnyEdit.build() : buildOutput(); } catch (e) { toast("生成保存内容失败：" + e.message); return; }
  saving = true;
  resolveHandle().then(function(h){
    if (h) { return h; }
    return pickHandle();
  }).then(function(h){
    if (!h) {
      downloadText(html, baseName() + "（批注版）.html", "text/html");
      dirty = false; updateSaveState();
      toast("此浏览器不支持原地保存，已下载副本");
      return null;
    }
    return ensureWrite(h).then(function(ok){
      if (!ok) { toast("没有写入权限（可再按一次 Ctrl+S 重新授权）"); return null; }
      return writeHandle(h, html).then(function(){ markSaved(); }, function(err){
        fileHandle = null;
        toast("写入失败（" + (err && err.name || "错误") + "），请再按一次 Ctrl+S 重新选择文件");
      });
    });
  }).catch(function(err){
    if (err && err.name === "AbortError") { return; }
    downloadText(html, baseName() + "（批注版）.html", "text/html");
    toast("无法直接写回，已下载副本：" + (err && err.message || ""));
  }).then(function(){ saving = false; }, function(){ saving = false; });
}
function updateSaveState(){
  var el = q1("#pvnt-state");
  if (!el) { return; }
  if (dirty) {
    el.className = "pvnt-state dirty";
    el.textContent = fileHandle ? "● 有未保存的修改" : "● 未保存（Ctrl+S 需先选一次文件）";
  } else {
    el.className = "pvnt-state";
    if (!fileHandle) { el.textContent = "未连接保存文件"; return; }
    var d = new Date(S.savedAt || now());
    el.textContent = "已连接文件 · 已保存 " + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  }
}
function exportMdText(){
  var L = [], i, n, e, open = 0;
  for (i = 0; i < S.notes.length; i++) { if (S.notes[i].status !== "done") { open++; } }
  L.push("# 批注清单 · " + (document.title || ""));
  L.push("");
  L.push("- 导出时间：" + fmtFull(now()));
  L.push("- 作者：" + (S.author || "匿名"));
  L.push("- 批注 " + S.notes.length + " 条（待处理 " + open + "） · 文字修改 " + S.edits.length + " 处");
  L.push("");
  L.push("## 一、批注（按正文顺序）");
  L.push("");
  var ord = orderedNotes();
  if (!ord.length) { L.push("（无）"); }
  for (i = 0; i < ord.length; i++) {
    n = ord[i];
    L.push("### " + (i + 1) + ". [" + (n.label || n.sec || "页面") + "] " + (n.status === "done" ? "已处理" : "待处理"));
    L.push("");
    L.push("> 原文：" + nrm(n.snippet).slice(0, 200) + (n._r ? "" : "   ← 定位失效（原文可能已改写）"));
    L.push("");
    L.push(n.text);
    L.push("");
    L.push("*（" + (n.author || "匿名") + " · " + fmtShort(n.ts) + "）*");
    L.push("");
  }
  L.push("## 二、文字修改");
  L.push("");
  if (!S.edits.length) { L.push("（无）"); }
  for (i = 0; i < S.edits.length; i++) {
    e = S.edits[i];
    L.push((i + 1) + ". " + (e.a2 && e.a2.label ? "[" + e.a2.label + "] " : "") + nrm(e.old).slice(0, 120) + "  →  " + nrm(e.next).slice(0, 120));
  }
  L.push("");
  L.push("---");
  L.push("");
  L.push("把本文件（或这份 md）发回给作者，即可按锚点逐条修订并出新版。");
  return L.join(String.fromCharCode(10));
}
function doExportMd(){
  downloadText(exportMdText(), baseName() + "_批注_" + stamp() + ".md", "text/markdown");
  toast("已导出批注清单 .md");
}
function copyText(txt){
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(txt).then(function(){ toast("批注已复制到剪贴板"); }, function(){ fallbackCopy(txt); });
  } else { fallbackCopy(txt); }
}
function fallbackCopy(txt){
  var ta = document.createElement("textarea");
  ta.value = txt;
  ta.style.cssText = "position:fixed;left:-9999px;top:0;";
  document.body.appendChild(ta); ta.select();
  try { document.execCommand("copy"); toast("批注已复制"); } catch (e) { toast("复制失败，请用「导出 .md」"); }
  ta.parentNode.removeChild(ta);
}
function doImport(){
  var onText = function(t){ mergeImported(t); };
  if (window.showOpenFilePicker) {
    window.showOpenFilePicker({ multiple: false, types: [{ description: "批注文件 / 面板", accept: { "application/json": [".json"], "text/html": [".html"] } }] })
      .then(function(hs){ return hs[0].getFile(); })
      .then(function(f){ return f.text(); })
      .then(onText)
      .catch(function(err){ if (!err || err.name !== "AbortError") { toast("导入失败：" + (err && err.message)); } });
    return;
  }
  var inp = document.createElement("input");
  inp.type = "file"; inp.accept = ".json,.html";
  inp.onchange = function(){ var f = inp.files[0]; if (!f) { return; } var fr = new FileReader(); fr.onload = function(){ onText(String(fr.result)); }; fr.readAsText(f); };
  inp.click();
}
function mergeImported(text){
  var data = null, m;
  try { data = JSON.parse(text); } catch (e) {
    m = String(text).match(/<script[^>]*id="pv-notes-data"[^>]*>([\s\S]*?)<\/script>/i);
    if (m) { try { data = JSON.parse(m[1]); } catch (e2) { data = null; } }
  }
  if (!data || (!data.notes && !data.edits)) { toast("这不是有效的批注文件"); return; }
  var inc = sanitize(data), i, j, added = 0, upd = 0, found;
  for (i = 0; i < inc.notes.length; i++) {
    found = -1;
    for (j = 0; j < S.notes.length; j++) { if (S.notes[j].id === inc.notes[i].id) { found = j; break; } }
    if (found < 0) { S.notes.push(inc.notes[i]); added++; }
    else if ((inc.notes[i].ts || 0) > (S.notes[found].ts || 0)) { S.notes[found].text = inc.notes[i].text; S.notes[found].status = inc.notes[i].status; upd++; }
  }
  for (i = 0; i < inc.edits.length; i++) {
    found = -1;
    for (j = 0; j < S.edits.length; j++) { if (S.edits[j].id === inc.edits[i].id) { found = j; break; } }
    if (found < 0) { S.edits.push(inc.edits[i]); }
  }
  markDirty(); saveLocal(); renderAll();
  toast("导入完成：新增 " + added + " 条，更新 " + upd + " 条");
}


/* -------------------------------------------------------------------- UI */
var CSS_TEXT = [
"#pvnt-root{position:fixed;inset:0;z-index:2147483000;pointer-events:none;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif;font-size:13px;line-height:1.65;color:#1a1a1a;text-align:left;}",
"#pvnt-root *{box-sizing:border-box;}",
"#pvnt-root button{font:inherit;cursor:pointer;border:0;background:none;color:inherit;}",
"#pvnt-tab{position:fixed;right:0;top:42%;pointer-events:auto;transform:translateY(-50%);background:#1c7ed6;color:#fff;border-radius:8px 0 0 8px;padding:11px 7px;writing-mode:vertical-rl;letter-spacing:2px;font-size:12px;box-shadow:-3px 0 12px rgba(0,0,0,.2);}",
"#pvnt-tab:hover{background:#1864ab;}",
"#pvnt-tab .pvnt-cnt{writing-mode:horizontal-tb;display:block;margin-top:7px;background:#fff;color:#1c7ed6;border-radius:9px;padding:0 5px;font-size:11px;font-weight:700;text-align:center;}",
"#pvnt-selbtn{position:fixed;display:none;pointer-events:auto;background:#1c7ed6;color:#fff;border-radius:6px;padding:6px 12px;font-size:12px;box-shadow:0 4px 14px rgba(0,0,0,.28);}",
"#pvnt-selbtn:hover{background:#1864ab;}",
"#pvnt-pop{position:fixed;display:none;width:300px;max-width:92vw;background:#fff;border:1px solid #cfd8e3;border-radius:9px;box-shadow:0 12px 32px rgba(0,0,0,.22);padding:10px;pointer-events:auto;}",
"#pvnt-pop .pvnt-pop-quote{font-size:11.5px;color:#666;background:#f5f7fa;border-left:3px solid #adb5bd;padding:4px 8px;border-radius:3px;margin-bottom:7px;max-height:56px;overflow:hidden;}",
"#pvnt-pop textarea{width:100%;height:84px;resize:vertical;border:1px solid #cfd8e3;border-radius:6px;padding:7px 8px;font:inherit;font-size:12.5px;outline:none;}",
"#pvnt-pop textarea:focus{border-color:#1c7ed6;}",
"#pvnt-pop .pvnt-pop-b{display:flex;gap:8px;justify-content:flex-end;margin-top:8px;}",
"#pvnt-pop .pvnt-pop-b button{border-radius:6px;padding:5px 14px;font-size:12.5px;background:#eef2f7;color:#333;}",
"#pvnt-pop .pvnt-pop-b button.pri{background:#1c7ed6;color:#fff;}",
"#pvnt-drawer{position:fixed;top:0;right:0;height:100%;width:362px;max-width:94vw;background:#fff;box-shadow:-8px 0 28px rgba(0,0,0,.2);pointer-events:auto;transform:translateX(103%);transition:transform .18s ease;display:flex;flex-direction:column;}",
"#pvnt-drawer.open{transform:translateX(0);}",
"#pvnt-drawer .pvnt-hd{padding:11px 14px;border-bottom:1px solid #e6eaef;display:flex;align-items:center;gap:8px;background:#f8fafc;}",
"#pvnt-drawer .pvnt-hd b{font-size:14px;}",
"#pvnt-drawer .pvnt-hd .pvnt-x{margin-left:8px;font-size:20px;line-height:1;color:#888;padding:0 4px;}",
"#pvnt-drawer .pvnt-hd .pvnt-state{margin-left:auto;font-size:11px;color:#868e96;white-space:nowrap;}",
"#pvnt-drawer .pvnt-hd .pvnt-state.dirty{color:#e8590c;font-weight:700;}",
"#pvnt-drawer .pvnt-hd .pvnt-x:hover{color:#c92a2a;}",
"#pvnt-drawer .pvnt-author{display:flex;align-items:center;gap:6px;padding:8px 14px;border-bottom:1px solid #eef2f7;font-size:12px;color:#666;}",
"#pvnt-drawer .pvnt-author input{border:1px solid #cfd8e3;border-radius:5px;padding:3px 7px;font:inherit;font-size:12px;width:110px;outline:none;}",
"#pvnt-drawer .pvnt-bar{display:flex;flex-wrap:wrap;gap:6px;padding:9px 14px;border-bottom:1px solid #eef2f7;}",
"#pvnt-drawer .pvnt-bar button{border:1px solid #cfd8e3;border-radius:6px;padding:4px 9px;font-size:12px;background:#fff;color:#333;}",
"#pvnt-drawer .pvnt-bar button:hover{background:#f1f5f9;border-color:#adb5bd;}",
"#pvnt-drawer .pvnt-bar button.pri{background:#1c7ed6;border-color:#1c7ed6;color:#fff;}",
"#pvnt-drawer .pvnt-bar button.pri:hover{background:#1864ab;}",
"#pvnt-drawer .pvnt-tip{padding:7px 14px;font-size:11.5px;color:#7a8698;background:#f8fafc;border-bottom:1px solid #eef2f7;}",
"#pvnt-drawer .pvnt-body{flex:1;overflow-y:auto;overscroll-behavior:contain;padding:10px 12px 40px;}",
"#pvnt-drawer .pvnt-empty{color:#8a94a6;font-size:12.5px;padding:22px 10px;text-align:center;line-height:2;}",
"#pvnt-drawer .pvnt-sub{font-size:11.5px;font-weight:700;color:#495057;letter-spacing:.5px;margin:12px 2px 6px;}",
"#pvnt-drawer .pvnt-item{border:1px solid #e0e6ee;border-left:3px solid #ffd43b;border-radius:7px;padding:8px 10px;margin-bottom:9px;background:#fff;cursor:pointer;}",
"#pvnt-drawer .pvnt-item:hover{background:#fbfdff;border-color:#a5c9ea;}",
"#pvnt-drawer .pvnt-item.done{border-left-color:#40c057;opacity:.72;}",
"#pvnt-drawer .pvnt-item.orphan{border-left-color:#e03131;}",
"#pvnt-drawer .pvnt-item-h{display:flex;align-items:center;gap:6px;font-size:11px;color:#7a8698;margin-bottom:4px;}",
"#pvnt-drawer .pvnt-idx{background:#1c7ed6;color:#fff;border-radius:50%;width:17px;height:17px;line-height:17px;text-align:center;font-size:10.5px;font-weight:700;flex:0 0 auto;}",
"#pvnt-drawer .pvnt-sec{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:150px;}",
"#pvnt-drawer .pvnt-chip{margin-left:auto;border-radius:9px;padding:0 6px;font-size:10.5px;background:#fff3bf;color:#8a6d00;flex:0 0 auto;}",
"#pvnt-drawer .pvnt-chip.done{background:#d3f9d8;color:#2b8a3e;}",
"#pvnt-drawer .pvnt-chip.orphan{background:#ffe3e3;color:#c92a2a;}",
"#pvnt-drawer .pvnt-quote{font-size:11.5px;color:#5c6570;background:#f5f7fa;border-left:2px solid #adb5bd;padding:3px 7px;border-radius:3px;margin-bottom:6px;max-height:52px;overflow:hidden;}",
"#pvnt-drawer .pvnt-text{font-size:13px;color:#1a1a1a;white-space:pre-wrap;word-break:break-word;}",
"#pvnt-drawer .pvnt-item-f{display:flex;align-items:center;gap:8px;margin-top:7px;font-size:11px;color:#98a2b3;}",
"#pvnt-drawer .pvnt-item-f .pvnt-acts{margin-left:auto;display:flex;gap:5px;}",
"#pvnt-drawer .pvnt-acts button{border:1px solid #dee2e6;border-radius:5px;padding:2px 7px;font-size:11px;background:#fff;color:#495057;}",
"#pvnt-drawer .pvnt-acts button:hover{background:#f1f3f5;}",
"#pvnt-drawer .pvnt-edit{border:1px solid #ffe0b2;background:#fffaf2;border-radius:7px;padding:7px 9px;margin-bottom:8px;font-size:12px;}",
"#pvnt-drawer .pvnt-edit .pvnt-eo{color:#a61e1e;text-decoration:line-through;}",
"#pvnt-drawer .pvnt-edit .pvnt-en{color:#186a3b;}",
"#pvnt-drawer .pvnt-edit .pvnt-acts{margin-top:5px;}",
".pvnt-edited{background:rgba(255,236,204,.65)!important;}",
".pvnt-editing{outline:2px solid #1c7ed6!important;outline-offset:2px;background:#fffbe6!important;}",
"::highlight(pvnt-note){background-color:rgba(255,212,59,.55);}",
"::highlight(pvnt-act){background-color:rgba(255,138,0,.62);}",
"#pvnt-toast{position:fixed;left:50%;bottom:30px;transform:translateX(-50%);background:rgba(24,24,24,.92);color:#fff;padding:8px 16px;border-radius:8px;font-size:12.5px;display:none;pointer-events:none;max-width:80vw;text-align:center;z-index:2147483001;}"
].join(String.fromCharCode(10));

function buildUI(){
  var st = document.createElement("style");
  st.id = "pvnt-style";
  st.textContent = CSS_TEXT;
  document.head.appendChild(st);

  root = document.createElement("div");
  root.id = ROOT_ID;
  root.innerHTML = [
    '<button id="pvnt-tab" type="button">批注<span class="pvnt-cnt" id="pvnt-cnt">0</span></button>',
    '<button id="pvnt-selbtn" type="button">＋ 批注</button>',
    '<div id="pvnt-pop">',
      '<div class="pvnt-pop-quote" id="pvnt-pop-quote"></div>',
      '<textarea id="pvnt-ta" placeholder="写批注…（Ctrl+Enter 保存，Esc 取消）"></textarea>',
      '<div class="pvnt-pop-b"><button type="button" id="pvnt-cancel">取消</button><button type="button" class="pri" id="pvnt-ok">保存批注</button></div>',
    '</div>',
    '<div id="pvnt-drawer">',
      '<div class="pvnt-hd"><b>批注与修改</b><span style="font-size:11px;color:#98a2b3">v1.1</span><span class="pvnt-state" id="pvnt-state"></span><button type="button" class="pvnt-x" id="pvnt-close">×</button></div>',
      '<div class="pvnt-author">我的名字：<input id="pvnt-author" type="text" placeholder="你的名字"><span style="font-size:11px;color:#aab2bd">（署名用；把文件发给同事时提醒对方改一下）</span></div>',
      '<div class="pvnt-bar">',
        '<button type="button" class="pri" id="pvnt-save" title="等价于 Ctrl+S">保存 (Ctrl+S)</button>',
        '<button type="button" id="pvnt-md">导出 .md</button>',
        '<button type="button" id="pvnt-copy">复制批注</button>',
        '<button type="button" id="pvnt-import">导入</button>',
        '<button type="button" id="pvnt-clear">清空</button>',
        '<button type="button" id="pvnt-edit-toggle">✎ 编辑</button>',
      '</div>',
      '<div class="pvnt-tip">选中文字 → 「＋ 批注」；双击文字 → 直接改。<b>Ctrl+S = 存回这个 HTML 文件</b>。每次打开文件后<b>第一次</b>按 Ctrl+S 会弹一次保存框（选你自己这个文件、覆盖），之后本次一直直接保存，不再弹框。</div>',
      '<div id="pvnt-frozenbar"></div>',
      '<div class="pvnt-body" id="pvnt-body"></div>',
    '</div>',
    '<div id="pvnt-toast"></div>'
  ].join("");
  document.body.appendChild(root);
}
function toast(msg){
  var el = q1("#pvnt-toast");
  if (!el) { return; }
  el.textContent = msg;
  el.style.display = "block";
  if (toastTimer) { clearTimeout(toastTimer); }
  toastTimer = setTimeout(function(){ el.style.display = "none"; toastTimer = null; }, 2600);
}
function openDrawer(open){
  var d = q1("#pvnt-drawer");
  if (!d) { return; }
  if (open === undefined) { open = !d.classList.contains("open"); }
  if (open) { d.classList.add("open"); } else { d.classList.remove("open"); }
}
function orderedNotes(){
  var arr = S.notes.slice(), i;
  for (i = 0; i < arr.length; i++) { arr[i]._r = arr[i]._r || locate(arr[i]); }
  arr.sort(function(a, b){
    if (a._r && b._r) {
      try { return a._r.compareBoundaryPoints(Range.START_TO_START, b._r); } catch (e) { return 0; }
    }
    if (a._r) { return -1; }
    if (b._r) { return 1; }
    return (a.ts || 0) - (b.ts || 0);
  });
  return arr;
}
function renderList(){
  var box = q1("#pvnt-body");
  if (!box) { return; }
  var ord = orderedNotes(), open = [], done = [], i, n, h = [];
  for (i = 0; i < ord.length; i++) { (ord[i].status === "done" ? done : open).push(ord[i]); }
  function card(n, idx){
    var orph = !n._r;
    return '<div class="pvnt-item' + (n.status === "done" ? ' done' : '') + (orph ? ' orphan' : '') + '" data-nid="' + esc(n.id) + '">' +
      '<div class="pvnt-item-h"><span class="pvnt-idx">' + idx + '</span><span class="pvnt-sec">' + esc(n.label || n.sec || "页面") + '</span>' +
      '<span class="pvnt-chip' + (n.status === "done" ? ' done' : '') + (orph ? ' orphan' : '') + '">' + (orph ? "定位失效" : (n.status === "done" ? "已处理" : "待处理")) + '</span></div>' +
      '<div class="pvnt-quote">' + esc(nrm(n.snippet).slice(0, 150)) + '</div>' +
      '<div class="pvnt-text">' + esc(n.text) + '</div>' +
      '<div class="pvnt-item-f"><span>' + esc(n.author || "匿名") + ' · ' + fmtShort(n.ts) + '</span>' +
      '<span class="pvnt-acts"><button type="button" data-act="goto" data-nid="' + esc(n.id) + '">定位</button>' +
      '<button type="button" data-act="done" data-nid="' + esc(n.id) + '">' + (n.status === "done" ? "重开" : "已处理") + '</button>' +
      '<button type="button" data-act="del" data-nid="' + esc(n.id) + '">删除</button></span></div></div>';
  }
  if (!ord.length) {
    h.push('<div class="pvnt-empty">还没有批注。<br>选中正文里的任意文字，点「＋ 批注」。</div>');
  } else {
    if (open.length) {
      h.push('<div class="pvnt-sub">待处理 · ' + open.length + '</div>');
      for (i = 0; i < open.length; i++) { h.push(card(open[i], i + 1)); }
    }
    if (done.length) {
      h.push('<div class="pvnt-sub">已处理 · ' + done.length + '</div>');
      for (i = 0; i < done.length; i++) { h.push(card(done[i], open.length + i + 1)); }
    }
  }
  if (S.edits.length) {
    h.push('<div class="pvnt-sub">文字修改 · ' + S.edits.length + '</div>');
    for (i = 0; i < S.edits.length; i++) {
      h.push('<div class="pvnt-edit"><div class="pvnt-eo">' + esc(nrm(S.edits[i].old).slice(0, 120)) + '</div>' +
        '<div class="pvnt-en">→ ' + esc(nrm(S.edits[i].next).slice(0, 120)) + '</div>' +
        '<div class="pvnt-acts"><button type="button" data-act="undo" data-eid="' + esc(S.edits[i].id) + '">还原</button></div></div>');
    }
  }
  box.innerHTML = h.join("");
}
function updateCount(){
  var c = q1("#pvnt-cnt"), i, n = 0;
  for (i = 0; i < S.notes.length; i++) { if (S.notes[i].status !== "done") { n++; } }
  if (c) { c.textContent = String(n); }
}
function renderAll(){
  refreshLoc();
  renderHighlights();
  renderList();
  updateCount();
}

/* ------------------------------------------------------------------ 交互 */
function addNote(a, text){
  if (!S.author) {
    var ai = q1("#pvnt-author");
    S.author = nrm(ai && ai.value) || "匿名";
    try { localStorage.setItem(LS_KEY + "::author", S.author); } catch (e) { }
  }
  var n = {
    id: uid(), sec: a.sec || "", off: a.off || 0, snippet: a.snippet, pre: a.pre || "", post: a.post || "",
    label: a.label || "", text: nrm(text), author: S.author, ts: now(), status: "open"
  };
  S.notes.push(n);
  markDirty(); saveLocal(); renderAll();
  return n;
}
function findNote(id){ var i; for (i = 0; i < S.notes.length; i++) { if (S.notes[i].id === id) { return S.notes[i]; } } return null; }
function delNote(id){
  var i;
  for (i = 0; i < S.notes.length; i++) { if (S.notes[i].id === id) { S.notes.splice(i, 1); break; } }
  markDirty(); saveLocal(); renderAll();
  toast("已删除");
}
function toggleNote(id){
  var n = findNote(id);
  if (!n) { return; }
  n.status = (n.status === "done") ? "open" : "done";
  markDirty(); saveLocal(); renderAll();
}
function activateTabFor(secEl){
  if (!secEl || secEl.offsetParent !== null) { return false; }
  var sel = '[data-tab="' + secEl.id + '"],nav a[href="#' + secEl.id + '"],nav [data-sec="' + secEl.id + '"]';
  var el = null;
  try { el = document.querySelector(sel); } catch (e) { el = null; }
  if (el) { try { el.click(); return true; } catch (e) { } }
  return false;
}
function forceScroll(top){
  var de = document.documentElement, be = document.body;
  var a = de.style.scrollBehavior, b = be ? be.style.scrollBehavior : "";
  de.style.scrollBehavior = "auto";
  if (be) { be.style.scrollBehavior = "auto"; }
  window.scrollTo(0, Math.max(0, top));
  setTimeout(function(){
    de.style.scrollBehavior = a;
    if (be) { be.style.scrollBehavior = b; }
  }, 80);
}
function gotoNote(id){
  var n = findNote(id);
  if (!n) { return; }
  var r = n._r || locate(n);
  if (!r) { toast("定位失效：这段原文可能已被改写"); return; }
  activeId = id;
  renderHighlights();
  var node = r.startContainer;
  var sec = (node.nodeType === 1 ? node : node.parentNode);
  while (sec && sec.tagName !== "SECTION") { sec = sec.parentNode; }
  var retried = false;
  var attempt = function(){
    var rr = n._r || locate(n);
    if (!rr) { toast("定位失效"); return; }
    var el = leafOf(rr) || sec || document.body;
    var rect = el.getBoundingClientRect();
    var navH = 64, nav = document.querySelector("nav");
    if (nav) { navH = nav.offsetHeight || navH; }
    try {
      var cp = window.getComputedStyle(document.documentElement).scrollPaddingTop;
      if (cp && cp.indexOf("px") > 0) { navH = Math.max(navH, parseFloat(cp)); }
    } catch (ec) { }
    var top = rect.top + (window.pageYOffset || 0) - navH - 18;
    forceScroll(top);
    var p = (el.nodeType === 1) ? el : el.parentNode;
    if (p && p.style) {
      var old = p.style.boxShadow;
      p.style.boxShadow = "0 0 0 3px rgba(255,138,0,.95)";
      setTimeout(function(){ p.style.boxShadow = old; }, 1400);
    }
  };
  if (sec && sec.offsetParent === null) {
    retried = activateTabFor(sec);
    if (retried) { setTimeout(function(){ refreshLoc(); renderHighlights(); attempt(); }, 220); return; }
  }
  attempt();
}
function startEdit(el){
  if (editCtx) { commitEdit(); }
  if (!el || el.nodeType !== 1 || SKIP_TAG[el.nodeName]) { return; }
  if (el.children && el.children.length) { return; }
  if (!nrm(el.textContent)) { return; }
  var a = null;
  try { var r = document.createRange(); r.selectNodeContents(el); a = anchorOfRange(r); } catch (e) { }
  editCtx = { el: el, a: a, old: el.textContent };
  el.setAttribute("contenteditable", "true");
  el.classList.add("pvnt-editing");
  try { el.focus(); } catch (e) { }
  toast("直接改，改完点空白处生效；Esc 取消");
}
function commitEdit(){
  if (!editCtx) { return; }
  var el = editCtx.el, oldT = editCtx.old, ctx = editCtx, newT, e, a2 = null;
  var keep = el.textContent;
  editCtx = null;
  el.removeAttribute("contenteditable");
  el.classList.remove("pvnt-editing");
  newT = nrm(keep);
  if (!newT || newT === nrm(oldT)) { el.textContent = oldT; return; }
  el.textContent = newT;
  try { var r = document.createRange(); r.selectNodeContents(el); a2 = anchorOfRange(r); } catch (er) { }
  if (!S.author) {
    var ai = q1("#pvnt-author");
    S.author = nrm(ai && ai.value) || "匿名";
  }
  e = { id: uid(), a: ctx.a, a2: a2, old: nrm(oldT), next: newT, author: S.author, ts: now() };
  S.edits.push(e);
  el.classList.add("pvnt-edited");
  el.setAttribute("data-pvnt-edit", "1");
  markDirty(); saveLocal(); renderAll();
  toast("已记录修改");
}
function cancelEdit(){
  if (!editCtx) { return; }
  var el = editCtx.el, oldT = editCtx.old;
  editCtx = null;
  el.removeAttribute("contenteditable");
  el.classList.remove("pvnt-editing");
  el.textContent = oldT;
}
function undoEdit(id){
  var i, e = null, idx = -1;
  for (i = 0; i < S.edits.length; i++) { if (S.edits[i].id === id) { e = S.edits[i]; idx = i; break; } }
  if (!e) { return; }
  var r = locate(e.a2 || e.a) || locate(e.a);
  if (r) {
    var p = leafOf(r);
    if (p && p.nodeType === 1 && (!p.children || !p.children.length) && nrm(p.textContent) === nrm(e.next)) {
      p.textContent = e.old;
      p.classList.remove("pvnt-edited");
      p.removeAttribute("data-pvnt-edit");
    }
  }
  S.edits.splice(idx, 1);
  markDirty(); saveLocal(); renderAll();
  toast("已还原");
}

/* -------------------------------------------------------------- 选区按钮 */
function hideSelBtn(){ var b = q1("#pvnt-selbtn"); if (b) { b.style.display = "none"; } }
function showSelBtn(){
  var sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount < 1) { hideSelBtn(); return; }
  var txt = nrm(sel.toString());
  if (txt.length < 2) { hideSelBtn(); return; }
  var range = sel.getRangeAt(0);
  if (inRoot(range.startContainer) || inRoot(range.endContainer)) { hideSelBtn(); return; }
  var b = q1("#pvnt-selbtn");
  if (!b) { return; }
  var r = range.getBoundingClientRect();
  if (!r || (r.width === 0 && r.height === 0)) { hideSelBtn(); return; }
  b.style.display = "block";
  var w = 78, top = r.top - 36;
  if (top < 8) { top = r.bottom + 8; }
  b.style.left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8) + "px";
  b.style.top = top + "px";
}
function openComposer(){
  var sel = window.getSelection();
  if (!sel || sel.rangeCount < 1) { return; }
  var range = sel.getRangeAt(0);
  var a = anchorOfRange(range);
  if (!a) { toast("这段选不中，换一段试试"); return; }
  selAnchor = a;
  var pop = q1("#pvnt-pop");
  var r = range.getBoundingClientRect();
  q1("#pvnt-pop-quote").textContent = nrm(a.snippet).slice(0, 120);
  pop.style.display = "block";
  var w = 300, left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
  var top = r.bottom + 9;
  if (top + 175 > window.innerHeight) { top = Math.max(8, r.top - 175); }
  pop.style.left = left + "px";
  pop.style.top = top + "px";
  var ta = q1("#pvnt-ta");
  ta.value = "";
  hideSelBtn();
  setTimeout(function(){ try { ta.focus(); } catch (e) { } }, 30);
}
function closeComposer(){
  var pop = q1("#pvnt-pop");
  if (pop) { pop.style.display = "none"; }
  selAnchor = null;
}
function submitComposer(){
  var ta = q1("#pvnt-ta");
  var v = nrm(ta && ta.value);
  if (!v) { toast("先写点什么"); return; }
  if (!selAnchor) { closeComposer(); return; }
  addNote(selAnchor, v);
  closeComposer();
  openDrawer(true);
  toast("已加批注");
}

/* ------------------------------------------------------------------ 事件 */
function stopAll(e){ e.stopPropagation(); }
function bindEvents(){
  root.addEventListener("mousedown", stopAll);
  root.addEventListener("mouseup", stopAll);
  root.addEventListener("click", stopAll);
  root.addEventListener("dblclick", stopAll);
  root.addEventListener("pointerdown", stopAll);
  root.addEventListener("wheel", stopAll, { passive: true });
  root.addEventListener("keydown", stopAll);
  root.addEventListener("keyup", stopAll);
  root.addEventListener("keypress", stopAll);

  root.addEventListener("click", function(e){
    var t = e.target;
    if (!t || !t.closest) { return; }
    var act = t.closest("[data-act]");
    if (act) {
      var a = act.getAttribute("data-act");
      if (a === "goto") { gotoNote(act.getAttribute("data-nid")); }
      else if (a === "del") { delNote(act.getAttribute("data-nid")); }
      else if (a === "done") { toggleNote(act.getAttribute("data-nid")); }
      else if (a === "undo") { undoEdit(act.getAttribute("data-eid")); }
      return;
    }
    if (t.closest("#pvnt-tab")) { openDrawer(); return; }
    if (t.closest("#pvnt-close")) { openDrawer(false); return; }
    if (t.closest("#pvnt-selbtn")) { openComposer(); return; }
    if (t.closest("#pvnt-ok")) { submitComposer(); return; }
    if (t.closest("#pvnt-cancel")) { closeComposer(); return; }
    if (t.closest("#pvnt-save")) { doSave(); return; }
    if (t.closest("#pvnt-md")) { doExportMd(); return; }
    if (t.closest("#pvnt-copy")) { copyText(exportMdText()); return; }
    if (t.closest("#pvnt-import")) { doImport(); return; }
    if (t.closest("#pvnt-clear")) {
      if (window.confirm("清空本页所有批注与修改记录？（文件里已保存的不会自动清除，以本页为准）")) {
        S.notes = []; S.edits = [];
        markDirty(); saveLocal(); renderAll();
      }
      return;
    }
    var item = t.closest(".pvnt-item");
    if (item) { gotoNote(item.getAttribute("data-nid")); return; }
  });
  root.addEventListener("input", function(e){
    if (e.target && e.target.id === "pvnt-author") {
      S.author = nrm(e.target.value);
      try { localStorage.setItem(LS_KEY + "::author", S.author); } catch (er) { }
    }
  });
  var ta = q1("#pvnt-ta");
  if (ta) {
    ta.addEventListener("keydown", function(e){
      if (e.key === "Escape") { e.preventDefault(); closeComposer(); }
      else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submitComposer(); }
    });
  }

  document.addEventListener("mouseup", function(e){
    if (e.target && e.target.closest && e.target.closest("#" + ROOT_ID)) { return; }
    setTimeout(showSelBtn, 0);
  });
  document.addEventListener("mousedown", function(e){
    if (e.target && e.target.closest && e.target.closest("#" + ROOT_ID)) { return; }
    var pop = q1("#pvnt-pop");
    if (pop && pop.style.display === "block") {
      if (!e.target.closest("#pvnt-pop")) { closeComposer(); }
    }
    if (editCtx && editCtx.el && e.target !== editCtx.el && !editCtx.el.contains(e.target)) { commitEdit(); }
  });
  document.addEventListener("dblclick", function(e){
    var t = e.target;
    if (!t || !t.closest) { return; }
    if (t.closest("#" + ROOT_ID)) { return; }
    if (t.closest("nav") || t.closest("button") || t.closest("a")) { return; }
    if (t.nodeType === 1 && t.children.length === 0 && nrm(t.textContent)) {
      e.preventDefault();
      startEdit(t);
    }
  });
  document.addEventListener("keydown", function(e){
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === "s" || e.key === "S")) {
      e.preventDefault();
      e.stopPropagation();
      if (editCtx) { commitEdit(); }
      doSave();
      return;
    }
  }, true);
  document.addEventListener("keydown", function(e){
    if (e.key === "Escape") {
      if (editCtx) { cancelEdit(); return; }
      var pop = q1("#pvnt-pop");
      if (pop && pop.style.display === "block") { closeComposer(); return; }
    }
    if (e.altKey && (e.key === "n" || e.key === "N")) { openDrawer(); }
  });
  window.addEventListener("beforeunload", function(e){
    if (dirty) { e.preventDefault(); e.returnValue = ""; return ""; }
  });
}

/* ------------------------------------------------------------------ 初始化 */
function init(){
  buildUI();
  load();
  applyFrozen();
  reapplyEdits();
  var ai = q1("#pvnt-author");
  if (ai) { ai.value = S.author || "批注者"; }
  renderAll();
  bindEvents();
  updateSaveState();
  resolveHandle().then(function(h){ if (h) { updateSaveState(); } }, function(){ });
  window.PVNotes = {
    version: "2.0",
    state: S,
    render: renderAll,
    addNoteAt: function(secId, snippet, text){
      var el = document.getElementById(secId) || document.body;
      var tn = textNodes(el), full = joinText(tn), i = full.indexOf(snippet);
      if (i < 0) { return null; }
      var r = rangeAt(tn, i, snippet.length);
      if (!r) { return null; }
      var a = anchorOfRange(r);
      if (!a) { return null; }
      return addNote(a, text);
    },
    exportMd: exportMdText,
    buildOutput: buildOutput,
    saveToFile: doSave,
    saveState: function(){ return { dirty: dirty, hasHandle: !!fileHandle, name: currentFileName() }; },
    _idbPut: idbPut, _idbGet: idbGet, _fileKey: fileKey,
    _: {
      S: S, ROOT_ID: ROOT_ID, LS_KEY: LS_KEY,
      now: now, nrm: nrm, esc: esc, inRoot: inRoot,
      markDirty: markDirty, saveLocal: saveLocal, toast: toast,
      renderAll: renderAll, watchFrozen: watchFrozen,
      userBusy: function(){ return !!editCtx; }
    },
    locate: locate,
    openDrawer: openDrawer
  };
  if (window.__PVNT_EDITOR__) {
    try { window.__PVNT_EDITOR__(); } catch (e) { try { console.log("[pv-notes] editor init failed", e); } catch (e2) { } }
  }
  try { console.log("[pv-notes] ready · notes=" + S.notes.length + " edits=" + S.edits.length + " frozen=" + S.frozen.length); } catch (e) { }
}
if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", init); }
else { setTimeout(init, 0); }
})();

/* =====================================================================
   pv-notes 编辑器 v2.0  ·  块级编辑（删 / 上下移 / 复制 / 表格增删行列 / 源码编辑）
   + 冻结保护：改过的区域会「锁定」，面板重新渲染也覆盖不掉，随文件一起保存
   由主模块在 init 末尾调用 window.__PVNT_EDITOR__()
   ===================================================================== */
(function () {
"use strict";

window.__PVNT_EDITOR__ = function () {
  var P = window.PVNotes;
  if (!P || !P._) { return; }
  var I = P._;
  var S = I.S;
  var ROOT_ID = I.ROOT_ID;

  var WL = "p,h1,h2,h3,h4,h5,ul,ol,table,blockquote,figure,pre,hr,dl,li";
  var EDIT_ON = false;
  var curBlock = null;
  var undoStack = [];
  var bar = null, ribbon = null;

  /* ------------------------------------------------------------ 样式 */
  function injectCss(){
    if (document.getElementById("pvnt-edit-style")) { return; }
    var st = document.createElement("style");
    st.id = "pvnt-edit-style";
    st.textContent = [
      "#pvnt-editbar{position:fixed;display:none;z-index:2147483100;pointer-events:auto;background:#111827;color:#fff;border-radius:8px;padding:4px 5px;box-shadow:0 8px 24px rgba(0,0,0,.35);display:none;align-items:center;gap:3px;font-size:12px;}",
      "#pvnt-editbar.on{display:flex;}",
      "#pvnt-editbar button{background:#374151;color:#fff;border:0;border-radius:5px;padding:3px 7px;font-size:12px;cursor:pointer;line-height:1.5;}",
      "#pvnt-editbar button:hover{background:#4b5563;}",
      "#pvnt-editbar button.danger:hover{background:#c92a2a;}",
      "#pvnt-editbar button.on{background:#1c7ed6;}",
      "#pvnt-editbar .sep{width:1px;height:16px;background:#4b5563;margin:0 3px;}",
      "#pvnt-editbar .lbl{font-size:11px;color:#9ca3af;padding:0 4px;max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
      "#pvnt-ribbon{position:fixed;left:50%;top:0;transform:translateX(-50%);z-index:2147483090;pointer-events:auto;background:#111827;color:#fff;border-radius:0 0 9px 9px;padding:6px 14px;font-size:12px;box-shadow:0 6px 18px rgba(0,0,0,.28);display:none;align-items:center;gap:10px;}",
      "#pvnt-ribbon.on{display:flex;}",
      "#pvnt-ribbon b{color:#ffd43b;}",
      "#pvnt-ribbon button{background:#374151;color:#fff;border:0;border-radius:5px;padding:3px 9px;font-size:12px;cursor:pointer;}",
      "#pvnt-ribbon button:hover{background:#4b5563;}",
      "body.pvnt-edit-on .pvnt-hoverblock{outline:2px dashed #1c7ed6!important;outline-offset:2px;}",
      "#pvnt-srcwrap{position:fixed;inset:0;z-index:2147483200;background:rgba(0,0,0,.45);display:none;align-items:center;justify-content:center;pointer-events:auto;}",
      "#pvnt-srcwrap.on{display:flex;}",
      "#pvnt-srcbox{background:#fff;border-radius:10px;width:min(900px,94vw);height:min(80vh,760px);display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.4);}",
      "#pvnt-srcbox .h{padding:10px 14px;border-bottom:1px solid #e5e7eb;font-weight:700;font-size:13px;display:flex;align-items:center;gap:10px;}",
      "#pvnt-srcbox .h button{margin-left:auto;border:0;background:#1c7ed6;color:#fff;border-radius:6px;padding:5px 12px;font-size:12.5px;cursor:pointer;}",
      "#pvnt-srcbox .h button.g{background:#eef2f7;color:#333;}",
      "#pvnt-srcbox textarea{flex:1;border:0;outline:none;padding:12px 14px;font-family:Consolas,'Courier New',monospace;font-size:12px;line-height:1.6;resize:none;}",
      "#pvnt-frozenbar{padding:7px 14px;font-size:11.5px;color:#8a6d00;background:#fff9db;border-bottom:1px solid #ffe8a1;display:none;align-items:center;gap:8px;}",
      "#pvnt-frozenbar.on{display:flex;}",
      "#pvnt-frozenbar button{border:1px solid #ffd43b;background:#fff;border-radius:5px;padding:2px 8px;font-size:11.5px;cursor:pointer;}"
    ].join(String.fromCharCode(10));
    document.head.appendChild(st);
  }

  /* -------------------------------------------------------- 块与锁定区 */
  function inRoot(n){ return I.inRoot(n); }
  function blockAt(t){
    if (!t || t.nodeType !== 1) { return null; }
    if (inRoot(t)) { return null; }
    if (t.tagName === "HTML" || t.tagName === "BODY" || t.tagName === "MAIN" || t.tagName === "NAV") { return null; }
    var b = null;
    try { b = t.closest(WL); } catch (e) { b = null; }
    if (!b) { try { b = t.closest("div,section,details,aside"); } catch (e2) { b = null; } }
    if (!b || inRoot(b) || b.tagName === "MAIN" || b === document.body) { return null; }
    return b;
  }
  function rootOf(el){
    var n = el, sec = null;
    while (n && n !== document.body) {
      if (n.tagName === "SECTION" && n.id) { sec = n; }
      if (n.id && n.id !== ROOT_ID && !inRoot(n)) { return n; }
      n = n.parentNode;
    }
    return sec;
  }
  function regionName(el){
    if (!el) { return ""; }
    var nb = null;
    try { nb = document.querySelector('[data-tab="' + el.id + '"]'); } catch (e) { nb = null; }
    if (nb) { return I.nrm(nb.textContent).slice(0, 24); }
    return el.id || el.tagName;
  }
  function recordUndo(root){
    if (!root || !root.id) { return; }
    undoStack.push({ id: root.id, html: root.innerHTML });
    if (undoStack.length > 15) { undoStack.shift(); }
  }
  function freeze(root){
    if (!root || !root.id) { I.toast("这块区域没有 id，无法锁定，改动可能不被保留"); return null; }
    var html = root.innerHTML, i, found = false;
    for (i = 0; i < S.frozen.length; i++) {
      if (S.frozen[i].id === root.id) { S.frozen[i].html = html; S.frozen[i].ts = I.now(); found = true; break; }
    }
    if (!found) { S.frozen.push({ id: root.id, html: html, ts: I.now() }); }
    I.markDirty();
    I.watchFrozen(root, html);
    refreshFrozenBar();
    return root;
  }
  function after(root, block){
    freeze(root);
    curBlock = block || null;
    if (curBlock && curBlock.parentNode) { positionBar(curBlock); } else { hideBar(); }
  }

  /* ------------------------------------------------------------ 操作 */
  function move(dir){
    var b = curBlock;
    if (!b) { return; }
    var root = rootOf(b), p = b.parentNode;
    var sib = dir < 0 ? b.previousElementSibling : b.nextElementSibling;
    if (!sib) { I.toast(dir < 0 ? "已经是第一个" : "已经是最后一个"); return; }
    recordUndo(root);
    if (dir < 0) { p.insertBefore(b, sib); } else { p.insertBefore(sib, b); }
    after(root, b);
  }
  function del(){
    var b = curBlock;
    if (!b) { return; }
    var txt = I.nrm(b.textContent).slice(0, 40);
    var big = b.tagName === "SECTION" || txt.length > 30;
    if (big && !window.confirm("删除这一块？" + String.fromCharCode(10) + String.fromCharCode(10) + "「" + txt + "…」" + String.fromCharCode(10) + "（Ctrl+Z 可撤销）")) { return; }
    var root = rootOf(b);
    recordUndo(root);
    b.parentNode.removeChild(b);
    curBlock = null; hideBar();
    after(root, null);
    I.toast("已删除（Ctrl+Z 撤销）");
  }
  function dup(){
    var b = curBlock;
    if (!b) { return; }
    var root = rootOf(b);
    recordUndo(root);
    var c = b.cloneNode(true);
    if (c.id) { c.removeAttribute("id"); }
    b.parentNode.insertBefore(c, b.nextSibling);
    after(root, c);
    I.toast("已复制");
  }
  function insertAfter(html, tip){
    var b = curBlock;
    if (!b) { I.toast("先选一块"); return; }
    var root = rootOf(b);
    recordUndo(root);
    var tmp = document.createElement("div");
    tmp.innerHTML = html;
    var first = tmp.firstElementChild, n;
    while ((n = tmp.firstChild)) { b.parentNode.insertBefore(n, b.nextSibling); }
    after(root, first || b);
    I.toast(tip || "已插入");
  }

  /* ---------------------------------------------------------- 表格操作 */
  function tblRows(tb){ return tb.rows; }
  function addRow(){
    var tb = curBlock;
    if (!tb || tb.tagName !== "TABLE") { return; }
    var root = rootOf(tb);
    recordUndo(root);
    var body = tb.tBodies[tb.tBodies.length - 1];
    if (!body) { body = document.createElement("tbody"); tb.appendChild(body); }
    var ref = body.rows[body.rows.length - 1] || tb.rows[tb.rows.length - 1];
    var tr = document.createElement("tr"), n = ref ? ref.cells.length : 1, td;
    for (var i = 0; i < n; i++) { td = document.createElement("td"); td.textContent = "（双击输入）"; tr.appendChild(td); }
    body.appendChild(tr);
    after(root, tb);
  }
  function delRow(){
    var tb = curBlock;
    if (!tb || tb.tagName !== "TABLE") { return; }
    if (tb.rows.length <= 1) { I.toast("只剩一行了"); return; }
    var root = rootOf(tb);
    recordUndo(root);
    var body = tb.tBodies[tb.tBodies.length - 1] || tb;
    body.deleteRow(body.rows.length - 1);
    after(root, tb);
  }
  function addCol(){
    var tb = curBlock;
    if (!tb || tb.tagName !== "TABLE") { return; }
    var root = rootOf(tb);
    recordUndo(root);
    var i, r, cell, tag;
    for (i = 0; i < tb.rows.length; i++) {
      r = tb.rows[i];
      tag = (r.parentNode.tagName === "THEAD") ? "th" : "td";
      cell = document.createElement(tag);
      cell.textContent = "（双击输入）";
      r.appendChild(cell);
    }
    after(root, tb);
  }
  function delCol(){
    var tb = curBlock;
    if (!tb || tb.tagName !== "TABLE") { return; }
    var root = rootOf(tb);
    recordUndo(root);
    var i, r;
    for (i = 0; i < tb.rows.length; i++) {
      r = tb.rows[i];
      if (r.cells.length > 1) { r.deleteCell(r.cells.length - 1); }
    }
    after(root, tb);
  }

  /* ------------------------------------------------------------ 源码编辑 */
  function sourceEdit(){
    var b = curBlock;
    if (!b) { return; }
    openSrc(b.outerHTML, function(v){
      var tmp = document.createElement("div");
      tmp.innerHTML = v;
      var nw = tmp.firstElementChild;
      if (!nw) { I.toast("内容为空，已取消"); return; }
      var root = rootOf(b);
      recordUndo(root);
      b.parentNode.replaceChild(nw, b);
      after(root, nw);
      I.toast("已应用源码修改");
    });
  }
  function openSrc(html, onOk){
    var w = document.getElementById("pvnt-srcwrap");
    if (!w) {
      w = document.createElement("div");
      w.id = "pvnt-srcwrap";
      w.innerHTML = '<div id="pvnt-srcbox"><div class="h">编辑 HTML 片段（可直接改标签、class、样式）<button class="g" id="pvnt-src-cancel">取消</button><button id="pvnt-src-ok">应用</button></div><textarea id="pvnt-src-ta" spellcheck="false"></textarea></div>';
      document.getElementById(ROOT_ID).appendChild(w);
      w.addEventListener("click", function(e){ if (e.target === w) { closeSrc(); } });
      w.addEventListener("keydown", function(e){ e.stopPropagation(); if (e.key === "Escape") { closeSrc(); } });
      document.getElementById("pvnt-src-cancel").addEventListener("click", closeSrc);
    }
    var ta = document.getElementById("pvnt-src-ta");
    ta.value = html;
    w.classList.add("on");
    srcApply = onOk;
    var okBtn = document.getElementById("pvnt-src-ok");
    okBtn.onclick = function(){ var v = ta.value; closeSrc(); if (srcApply) { srcApply(v); } };
    setTimeout(function(){ ta.focus(); }, 30);
  }
  var srcApply = null;
  function closeSrc(){
    var w = document.getElementById("pvnt-srcwrap");
    if (w) { w.classList.remove("on"); }
  }

  /* ------------------------------------------------------------ 工具条 */
  function buildBar(){
    bar = document.createElement("div");
    bar.id = "pvnt-editbar";
    bar.innerHTML = [
      '<span class="lbl" id="pvnt-eb-lbl"></span>',
      '<button type="button" data-op="up" title="上移">⬆</button>',
      '<button type="button" data-op="down" title="下移">⬇</button>',
      '<button type="button" data-op="dup" title="复制一块">⧉</button>',
      '<button type="button" data-op="src" title="编辑 HTML 源码">&lt;/&gt;</button>',
      '<button type="button" data-op="del" class="danger" title="删除">✕</button>',
      '<span class="sep" data-tbl="1"></span>',
      '<button type="button" data-op="addrow" data-tbl="1" title="加一行">＋行</button>',
      '<button type="button" data-op="delrow" data-tbl="1" title="删最后一行">－行</button>',
      '<button type="button" data-op="addcol" data-tbl="1" title="加一列">＋列</button>',
      '<button type="button" data-op="delcol" data-tbl="1" title="删最后一列">－列</button>',
      '<span class="sep"></span>',
      '<button type="button" data-op="addp" title="在下方插入段落">＋段落</button>',
      '<button type="button" data-op="addtbl" title="在下方插入表格">＋表格</button>'
    ].join("");
    document.getElementById(ROOT_ID).appendChild(bar);
    bar.addEventListener("click", function(e){
      var b = e.target.closest ? e.target.closest("button[data-op]") : null;
      if (!b || !curBlock) { return; }
      var op = b.getAttribute("data-op");
      if (op === "up") { move(-1); }
      else if (op === "down") { move(1); }
      else if (op === "dup") { dup(); }
      else if (op === "del") { del(); }
      else if (op === "src") { sourceEdit(); }
      else if (op === "addrow") { addRow(); }
      else if (op === "delrow") { delRow(); }
      else if (op === "addcol") { addCol(); }
      else if (op === "delcol") { delCol(); }
      else if (op === "addp") { insertAfter("<p>（双击这里输入文字）</p>"); }
      else if (op === "addtbl") { insertAfter('<table><thead><tr><th style="width:34%">表头</th><th>说明</th></tr></thead><tbody><tr><td>（双击输入）</td><td>（双击输入）</td></tr></tbody></table>'); }
    });
  }
  function positionBar(b){
    if (!bar || !b || !b.isConnected) { hideBar(); return; }
    var r = b.getBoundingClientRect();
    var isTbl = b.tagName === "TABLE";
    var lbl = document.getElementById("pvnt-eb-lbl");
    if (lbl) { lbl.textContent = (isTbl ? "表格" : b.tagName.toLowerCase()) + " · 锁定区：" + regionName(rootOf(b)); }
    var kids = bar.querySelectorAll("[data-tbl]"), i;
    for (i = 0; i < kids.length; i++) { kids[i].style.display = isTbl ? "" : "none"; }
    bar.classList.add("on");
    var w = bar.offsetWidth, h = bar.offsetHeight;
    var left = Math.min(Math.max(6, r.right - w), window.innerWidth - w - 6);
    var top = r.top - h - 6;
    if (top < 40) { top = r.top + 6; }
    bar.style.left = left + "px";
    bar.style.top = top + "px";
  }
  function hideBar(){ if (bar) { bar.classList.remove("on"); } }
  function buildRibbon(){
    ribbon = document.createElement("div");
    ribbon.id = "pvnt-ribbon";
    ribbon.innerHTML = '<span>✎ <b>编辑模式</b>：鼠标悬停任意段落 / 表格 / 图片块 → 右上角出现 <b>⬆ ⬇ ⧉ ✕</b>；表格多出「＋行/－行/＋列/－列」；双击任意文字直接改；<b>Ctrl+Z</b> 撤销；<b>Ctrl+S</b> 存回文件。</span><button type="button" id="pvnt-ribbon-off">退出编辑</button>';
    document.getElementById(ROOT_ID).appendChild(ribbon);
    document.getElementById("pvnt-ribbon-off").addEventListener("click", function(){ setEdit(false); });
  }

  /* -------------------------------------------------------- 开关与绑定 */
  function setEdit(on){
    EDIT_ON = !!on;
    injectCss();
    document.body.classList.toggle("pvnt-edit-on", EDIT_ON);
    if (ribbon) { ribbon.classList.toggle("on", EDIT_ON); }
    if (!EDIT_ON) { hideBar(); curBlock = null; }
    try { localStorage.setItem(I.LS_KEY + "::editmode", EDIT_ON ? "1" : "0"); } catch (e) { }
    var tb = document.getElementById("pvnt-edit-toggle");
    if (tb) { tb.classList.toggle("pri", EDIT_ON); tb.textContent = EDIT_ON ? "✎ 编辑中" : "✎ 编辑"; }
    I.toast(EDIT_ON ? "编辑模式已开：悬停内容块 → 右上角操作" : "已退出编辑模式");
  }
  function refreshFrozenBar(){
    var el = document.getElementById("pvnt-frozenbar");
    if (!el) { return; }
    if (!S.frozen.length) { el.classList.remove("on"); el.innerHTML = ""; return; }
    var names = [], i, e;
    for (i = 0; i < S.frozen.length; i++) {
      e = document.getElementById(S.frozen[i].id);
      names.push(regionName(e) || S.frozen[i].id);
    }
    el.classList.add("on");
    el.innerHTML = '<span>🔒 已编辑并锁定 ' + S.frozen.length + ' 个区域：' + I.esc(names.join("、")) +
      '（面板重新渲染不会覆盖你的改动）</span><button type="button" id="pvnt-unfreeze">全部还原为原始</button>';
    var ub = document.getElementById("pvnt-unfreeze");
    if (ub && !ub.__b) {
      ub.__b = 1;
      ub.addEventListener("click", function(){
        if (!window.confirm("放弃这些区域的编辑，恢复面板原始内容？（会重新载入页面）")) { return; }
        S.frozen = [];
        I.markDirty();
        try { I.saveLocal(); } catch (e) { }
        window.location.reload();
      });
    }
  }
  function undoEdit2(){
    var u = undoStack.pop();
    if (!u) { I.toast("没有可撤销的操作"); return; }
    var el = document.getElementById(u.id);
    if (!el) { I.toast("找不到被编辑的区域"); return; }
    el.innerHTML = u.html;
    var i, hit = false;
    for (i = 0; i < S.frozen.length; i++) { if (S.frozen[i].id === u.id) { S.frozen[i].html = u.html; S.frozen[i].ts = I.now(); hit = true; } }
    if (!hit) { S.frozen.push({ id: u.id, html: u.html, ts: I.now() }); }
    I.markDirty();
    I.watchFrozen(el, u.html);
    refreshFrozenBar();
    I.toast("已撤销");
  }

  function bind(){
    injectCss();
    buildBar();
    buildRibbon();
    refreshFrozenBar();
    document.addEventListener("mousemove", function(e){
      if (!EDIT_ON) { return; }
      if (e.target && e.target.closest && e.target.closest("#" + ROOT_ID)) { return; }
      var b = blockAt(e.target);
      if (b !== curBlock) { curBlock = b; }
      if (b) { positionBar(b); } else { hideBar(); }
    }, true);
    window.addEventListener("scroll", function(){ if (EDIT_ON && curBlock) { positionBar(curBlock); } }, { passive: true });
    document.addEventListener("keydown", function(e){
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === "z" || e.key === "Z")) {
        if (!EDIT_ON) { return; }
        var t = e.target;
        if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || (t.isContentEditable))) { return; }
        e.preventDefault(); e.stopPropagation();
        undoEdit2();
      }
    }, true);
    document.addEventListener("click", function(e){
      if (!EDIT_ON) { return; }
      var t = e.target;
      if (!t || !t.closest) { return; }
      if (t.closest("#" + ROOT_ID)) { return; }
      if (t.closest("a")) { e.preventDefault(); I.toast("编辑模式下链接已禁用（先退出编辑再点链接）"); }
    }, true);
    var tb = document.getElementById("pvnt-edit-toggle");
    if (tb) { tb.addEventListener("click", function(){ setEdit(!EDIT_ON); }); }
    var on = false;
    try { on = localStorage.getItem(I.LS_KEY + "::editmode") === "1"; } catch (e) { }
    if (on) { setEdit(true); }
  }
  bind();
  var api = {
    toggle: function(){ setEdit(!EDIT_ON); },
    set: setEdit,
    undo: undoEdit2,
    refreshFrozen: refreshFrozenBar,
    isOn: function(){ return EDIT_ON; },
    select: function(el){ curBlock = el; if (el) { positionBar(el); } else { hideBar(); } },
    frozen: function(){ return S.frozen; }
  };
  window.PVNT_EDIT = api;
  return api;
};

})();

