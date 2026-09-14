# -*- coding: utf-8 -*-
"""inject_pvnotes.py — 把 pv-notes 注入层塞进单文件 HTML（就地、幂等）"""
import io, re, sys, os

TEST_JS = u"""<script>
window.addEventListener("load", function(){
setTimeout(function(){
  var out = [];
  function push(k,v){ out.push(k+"="+v); }
  try {
    var sec = document.getElementById("principle") || document.querySelector("section[id]");
    push("sec", sec ? sec.id : "NONE");
    var full = sec ? sec.textContent : "";
    var s1 = full.substr(Math.min(400, Math.max(0, full.length - 200)), 90);
    var s2 = full.substr(Math.min(1200, Math.max(0, full.length - 140)), 70);
    var n1 = window.PVNotes.addNoteAt(sec.id, s1, "测试批注一：这里口径要跟专家确认。");
    var n2 = window.PVNotes.addNoteAt(sec.id, s2, "测试批注二：这条数据来源需要补。");
    push("note1", n1 ? "OK" : "FAIL");
    push("note2", n2 ? "OK" : "FAIL");
    window.PVNotes.render();
    push("items", document.querySelectorAll("#pvnt-drawer .pvnt-item").length);
    push("subs", document.querySelectorAll("#pvnt-drawer .pvnt-sub").length);
    push("cnt", (document.getElementById("pvnt-cnt")||{}).textContent);
    push("tabExists", !!document.getElementById("pvnt-tab"));
    push("drawerExists", !!document.getElementById("pvnt-drawer"));
    push("styleExists", !!document.getElementById("pvnt-style"));
    push("hlAPI", !!(window.CSS && CSS.highlights && window.Highlight));
    var hs = (window.CSS && CSS.highlights && CSS.highlights.get("pvnt-note"));
    push("hlSize", hs ? hs.size : "na");
    var st = window.PVNotes.state;
    push("locate", st.notes.map(function(x){ return window.PVNotes.locate(x) ? "1":"0"; }).join(""));
    var md = window.PVNotes.exportMd();
    push("mdLen", md.length);
    push("mdHasLabel", md.indexOf("测试批注一") >= 0 ? "1":"0");
    push("mdHead", md.split(String.fromCharCode(10)).slice(0,6).join(" ~ ").substr(0,220));
    var html = window.PVNotes.buildOutput();
    push("outLen", html.length);
    push("outModule", html.indexOf("pv-notes-module") >= 0 ? 1:0);
    push("outData", html.indexOf("pv-notes-data") >= 0 ? 1:0);
    // 断言用的字符串必须拼接：否则探针自己的源码里就含这个字面量，断言恒判「没剥干净」
    push("outRootGone", html.indexOf('id="pvnt-' + 'root"') < 0 ? 1:0);
    push("outDataHas", html.indexOf("测试批注一") >= 0 ? 1:0);
    push("outDoctype", html.substr(0,15).toLowerCase().indexOf("<!doctype") === 0 ? 1:0);
    push("outRootElement", html.indexOf('<div' + ' id="pvnt-' + 'root">') < 0 ? 1:0);
    var leaked = 0;
    document.addEventListener("click", function(){ leaked++; });
    var btnT = document.querySelector('#pvnt-drawer [data-act="del"]');
    if (btnT) { btnT.dispatchEvent(new MouseEvent("click", {bubbles:true})); }
    push("leakBubble", leaked);
    var b64 = btoa(unescape(encodeURIComponent(html)));
    push("outB64", b64);
    // 点击事件真打：点「定位」
    var btn = document.querySelector('#pvnt-drawer [data-act="goto"]');
    if (btn) { btn.dispatchEvent(new MouseEvent("click", {bubbles:true})); push("clickGoto", "sent"); } else { push("clickGoto","nobtn"); }
  } catch (err) {
    push("EXCEPTION", (err && err.message) + " | " + ((err && err.stack) || "").split(String.fromCharCode(10)).slice(0,3).join(" >> "));
  }
  var d = document.createElement("div");
  d.id = "pvnt-selftest-result";
  d.textContent = "TESTRESULT= " + out.join(" ;; ");
  document.body.appendChild(d);
}, 1200);
});
</script>"""

def inject(target_path, module_path, out_path, test=False):
    mod = io.open(module_path, encoding="utf-8").read()
    if "</script" in mod.lower():
        raise SystemExit("module contains a closing script tag")
    src = io.open(target_path, encoding="utf-8", newline="").read()
    src = re.sub(r'<script[^>]*id="pv-notes-module"[^>]*>.*?</script>', "", src, flags=re.S)
    src = re.sub(r'<script[^>]*id="pv-notes-data"[^>]*>.*?</script>', "", src, flags=re.S)
    block = []
    if test:
        _onerr = u'<script>window.onerror=function(m,s,l,c){var d=document.createElement("div");d.id="pvnt-selftest-error";d.textContent="JSERROR= "+m+" @line "+l;document.body.appendChild(d);};</script>'
        block.append(_onerr)
    block.append(u'<script id="pv-notes-data" type="application/json">{}</script>')
    block.append(u'<script id="pv-notes-module">' + mod + u'</script>')
    if test:
        block.append(TEST_JS)
    payload = u"\n".join(block) + u"\n"
    low = src.lower()
    idx = low.rfind("</body>")
    if idx < 0:
        idx = low.rfind("</html>")
    if idx < 0:
        idx = len(src)
    out = src[:idx] + payload + src[idx:]
    io.open(out_path, "w", encoding="utf-8", newline="").write(out)
    return len(out)

if __name__ == "__main__":
    a = sys.argv[1:]
    test = False
    if "--test" in a:
        test = True
        a.remove("--test")
    tgt, outp = a[0], a[1]
    modp = a[2] if len(a) > 2 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "pv-notes.js")
    n = inject(tgt, modp, outp, test=test)
    print("INJECTED %s -> %s (%d chars, test=%s)" % (tgt, outp, n, test))
