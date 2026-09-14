#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
verify_panel.py —— 单文件 HTML 面板的交付前自检（不需要人眼）。

用法
----
python verify_panel.py out.html [--width 1500] [--height 1000] [--chrome <路径>]

检查项
------
1. 抽 <script> 跑 node --check（若本机有 node）
2. headless Chrome --dump-dom 渲染
3. #jserr 是否为空（页面自带错误捕获器）
4. 页内所有 SVG：文字包围盒越界 + 文字标签互相重叠（估宽算法）
5. #pvanyedit-ui 数量必须恰好 1（多 = 编辑器 UI 被烘进文件）
6. pv-anyedit-data / pv-notes-data 数据块存在
7. 浮动控件是否被别的元素盖住（elementFromPoint 自击测试）
退出码：0 全过；1 有 FAIL。
"""
# ⚠️ PROBE 必须用 r""" 原始字符串：非 raw 的 Python 三引号会把 JS 里的 \n 变成真换行，
#    导致注入的 <script> 直接语法错误、静默不执行（本脚本踩过一次）。
#    更稳的做法：JS 里避免反斜杠，用 String.fromCharCode(9/10) 代替 \t \n。
import argparse
import io
import os
import re
import subprocess
import sys
import tempfile

PROBE = r"""
<pre id="__verify" style="font-size:11px;white-space:pre-wrap"></pre>
<script>
(function(){
  function pre(){ return document.getElementById('__verify'); }
  function L(k,v){
    try{ pre().textContent += k + String.fromCharCode(9) + String(v).replace(/\s+/g,' ') + String.fromCharCode(10); }catch(e){}
  }
  function T(k, fn){ try{ L(k, fn()); }catch(e){ L(k, 'THREW:' + (e && e.message)); } }
  window.addEventListener('load', function(){
    setTimeout(function(){
      T('uiCount', function(){ return document.querySelectorAll('#pvanyedit-ui').length; });
      T('hasAnyeditData', function(){ return !!document.getElementById('pv-anyedit-data'); });
      T('hasNotesData', function(){ return !!document.getElementById('pv-notes-data'); });
      T('PVAnyEdit', function(){ return typeof window.PVAnyEdit; });
      T('PVNotes', function(){ return typeof window.PVNotes; });
      T('jserr', function(){ var d=document.getElementById('jserr'); return d ? (d.textContent||'') : ''; });
      T('sections', function(){ return document.querySelectorAll('section').length; });
      T('svgCount', function(){ return document.querySelectorAll('svg').length; });
      ['#pvanyedit-ui .pae-toggle','#pvanyedit-ui .pae-save','#pvanyedit-ui .pae-auth'].forEach(function(sel, i){
        T('hit'+i, function(){
          var e=document.querySelector(sel);
          if(!e) return 'absent';
          var r=e.getBoundingClientRect();
          if(!r.width) return 'hidden(ok)';
          var h=document.elementFromPoint(r.left+r.width/2, r.top+r.height/2);
          return (h && (h===e || e.contains(h))) ? 'self' : ('COVERED-BY:'+(h?h.tagName+'.'+h.className:'null'));
        });
      });
      T('toolbar', function(){
        /* 如果面板带了「阅读 / 编辑」模式开关（pv-mode），先切到编辑模式 */
        try{ if(window.PVMode && window.PVMode.edit) window.PVMode.edit(); }catch(e){}
        var el=document.querySelector('main > section .card, section .card, main > section p, section p, .card, p, td');
        if(!el) return 'no-target';
        el.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));
        var bar=document.querySelector('[data-pae="bar"]');
        if(!bar) return 'missing';
        if(bar.className.indexOf('show')<0) return 'NOT-SHOWN';
        var r=bar.getBoundingClientRect();
        if(r.width<80||r.height<20) return 'TOO-SMALL:'+Math.round(r.width)+'x'+Math.round(r.height);
        if(r.top<-2||r.left<-2||r.bottom>window.innerHeight+2||r.right>window.innerWidth+2){
          return 'OFFSCREEN:'+Math.round(r.left)+','+Math.round(r.top)+' '+Math.round(r.width)+'x'+Math.round(r.height)
                 +' (viewport '+window.innerWidth+'x'+window.innerHeight+')';
        }
        return 'inside-viewport:'+Math.round(r.left)+','+Math.round(r.top)+' '+Math.round(r.width)+'x'+Math.round(r.height);
      });
      T('modeSwitch', function(){
        var b=document.getElementById('pv-mode-btn');
        if(!b) return 'absent(ok)';
        var r=b.getBoundingClientRect();
        if(!r.width) return 'HIDDEN';
        var h=document.elementFromPoint(r.left+r.width/2, r.top+r.height/2);
        return (h && (h===b||b.contains(h))) ? 'self' : ('COVERED-BY:'+(h?h.tagName:'.'));
      });
      T('done', function(){ return 'yes'; });
    }, 1800);
  });
})();
</script>
"""


def w_cjk(s, fs):
    w = 0.0
    for ch in s:
        w += (fs * 1.02) if ord(ch) > 0x2E80 else (fs * 0.58)
    return w


def find_chrome():
    cands = [
        r'C:\Program Files\Google\Chrome\Application\chrome.exe',
        r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
        os.path.expandvars(r'%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe'),
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/usr/bin/google-chrome',
    ]
    for c in cands:
        if os.path.exists(c):
            return c
    return None


def audit_svg(clean):
    problems = []
    svgs = re.findall(r'<svg viewBox="0 0 ([\d.]+) ([\d.]+)"[^>]*>(.*?)</svg>', clean, re.S)
    for si, (W, H, body) in enumerate(svgs):
        W, H = float(W), float(H)
        items = []
        for m in re.finditer(r'<text([^>]*)>(.*?)</text>', body, re.S):
            attrs = m.group(1)
            content = re.sub(r'<[^>]+>', '', m.group(2))
            content = (content.replace('&amp;', '&').replace('&lt;', '<')
                              .replace('&gt;', '>').replace('&nbsp;', ' '))
            if 'rotate' in attrs or not content.strip():
                continue
            fs = float(re.search(r'font-size="([\d.]+)"', attrs).group(1))
            x = float(re.search(r'x="([-\d.]+)"', attrs).group(1))
            y = float(re.search(r'y="([-\d.]+)"', attrs).group(1))
            am = re.search(r'text-anchor="(\w+)"', attrs)
            anchor = am.group(1) if am else 'start'
            tw = w_cjk(content, fs)
            if anchor == 'middle':
                x0, x1 = x - tw / 2, x + tw / 2
            elif anchor == 'end':
                x0, x1 = x - tw, x
            else:
                x0, x1 = x, x + tw
            items.append((content, x0, y - fs * 0.80, x1, y + fs * 0.22))
            if x0 < -3 or x1 > W + 3 or y < -3 or y > H + 3:
                problems.append('svg%d 文字越界: "%s" x[%.0f,%.0f] y=%.0f (画布 %.0fx%.0f)'
                                % (si, content[:14], x0, x1, y, W, H))
        for i in range(len(items)):
            for j in range(i + 1, len(items)):
                a, b = items[i], items[j]
                ox = min(a[3], b[3]) - max(a[1], b[1])
                oy = min(a[4], b[4]) - max(a[2], b[2])
                if ox > 1.0 and oy > 1.0:
                    problems.append('svg%d 标签重叠: "%s" <-> "%s" (dx=%.1f dy=%.1f)'
                                    % (si, a[0][:14], b[0][:14], ox, oy))
    return len(svgs), problems


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('target')
    ap.add_argument('--width', type=int, default=1500)
    ap.add_argument('--height', type=int, default=1000)
    ap.add_argument('--chrome', default=None)
    a = ap.parse_args()

    src = os.path.abspath(a.target)
    if not os.path.exists(src):
        raise SystemExit('文件不存在：%s' % src)
    html = io.open(src, encoding='utf-8').read()
    fails, warns = [], []

    # 1) JS 语法
    scripts = re.findall(r'<script(?![^>]*application/json)[^>]*>(.*?)</script>', html, re.S)
    for i, js in enumerate(scripts):
        if len(js.strip()) < 40:
            continue
        tmp = os.path.join(tempfile.gettempdir(), 'pvverify_%d.js' % i)
        io.open(tmp, 'w', encoding='utf-8').write(js)
        try:
            r = subprocess.run(['node', '--check', tmp], capture_output=True)
            if r.returncode != 0:
                fails.append('script[%d] node --check 失败：%s' % (i, r.stderr.decode('utf-8', 'replace')[:200]))
        except FileNotFoundError:
            warns.append('本机没有 node，跳过语法检查')
            break
    print('[1] JS 语法检查：%d 个 script' % len([s for s in scripts if len(s.strip()) >= 40]))

    # 2) 渲染 + DOM 事实
    chrome = a.chrome or find_chrome()
    if not chrome:
        warns.append('找不到 Chrome，跳过渲染检查（结构检查仍然执行）')
        dom = None
    else:
        work = tempfile.mkdtemp(prefix='pvverify_')
        page = os.path.join(work, 'panel.html')
        io.open(page, 'w', encoding='utf-8').write(html)
        # 注入探针（只替换最后一次 </body>，模块源码里可能含该字样）
        i = html.rfind('</body>')
        io.open(page, 'w', encoding='utf-8').write(html[:i] + PROBE + html[i:])
        domp = os.path.join(work, 'dom.html')
        ud = os.path.join(work, 'ud')
        os.makedirs(ud, exist_ok=True)
        url = 'file:///' + page.replace('\\', '/')
        args = ('--headless=new --disable-gpu --no-sandbox --user-data-dir=%s '
                '--virtual-time-budget=20000 --window-size=%d,%d --dump-dom %s'
                % (ud, a.width, a.height, url))
        try:
            with io.open(domp, 'w', encoding='utf-8') as fh:
                subprocess.run([chrome] + args.split(), stdout=fh, stderr=subprocess.DEVNULL, timeout=120)
            dom = io.open(domp, encoding='utf-8', errors='replace').read()
        except Exception as e:
            warns.append('渲染失败：%s' % e)
            dom = None

    if dom:
        m = re.search(r'<pre id="__verify"[^>]*>(.*?)</pre>', dom, re.S)
        if not m:
            warns.append('探针没跑起来（可能是脚本报错）')
        else:
            for line in m.group(1).split('\n'):
                if '\t' not in line:
                    continue
                k, v = line.split('\t', 1)
                v = v.strip()
                if k == 'jserr' and v:
                    fails.append('页面报错：%s' % v[:200])
                elif k == 'uiCount' and v != '1':
                    fails.append('#pvanyedit-ui 数量 = %s（应为 1；>1 说明编辑器 UI 被烘进了文件）' % v)
                elif k.startswith('hit') and v.startswith('COVERED'):
                    fails.append('浮动控件被遮挡：%s = %s' % (k, v))
                elif k == 'modeSwitch' and v.startswith(('HIDDEN', 'COVERED')):
                    fails.append('模式开关不可点：%s = %s' % (k, v))
                elif k == 'toolbar' and not v.startswith('inside-viewport'):
                    fails.append('工具条没有出现在视口内：%s（常见原因：容器是 position:fixed 无偏移，'
                                 '而工具条却用 position:absolute + 文档坐标定位 → 落到文档末尾）' % v)
                elif k in ('hasAnyeditData', 'hasNotesData') and v != 'true':
                    fails.append('%s = %s（注入块缺失）' % (k, v))
                print('    %s = %s' % (k, v))
        clean = re.sub(r'<script[^>]*>.*?</script>', ' ', dom, flags=re.S)
        n, probs = audit_svg(clean)
        print('[2] SVG 审计：%d 张，问题 %d 处' % (n, len(probs)))
        for p in probs[:20]:
            fails.append(p)
    else:
        n, probs = audit_svg(re.sub(r'<script[^>]*>.*?</script>', ' ', html, flags=re.S))
        print('[2] SVG 结构审计（未渲染）：%d 张，问题 %d 处' % (n, len(probs)))
        for p in probs[:20]:
            fails.append(p)

    print('\n===== 结论 =====')
    if warns:
        for w in warns:
            print('  [warn] %s' % w)
    if fails:
        for f in fails:
            print('  [FAIL] %s' % f)
        print('\n结果：不合格（%d 项）' % len(fails))
        return 1
    print('  结果：全部通过 ✅')
    return 0


if __name__ == '__main__':
    sys.exit(main())
