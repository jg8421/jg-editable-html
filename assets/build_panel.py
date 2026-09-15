#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_panel.py —— 把任意单文件 HTML 面板变成「可批注 + 任意编辑 + 可就地保存」的交付文件。

用法
----
# A) 已经是一个完整的 HTML（自带 head/style/body）
python build_panel.py content.html out.html

# B) 由若干片段拼装（目录下 *.html 按文件名排序拼接，最后一个是收尾片段）
python build_panel.py --parts <片段目录> out.html

它会做这些事：
1. 在 </style> 前注入编辑器所需的 CSS（#pvanyedit-ui / .pae-* / .pae-fs / .pae-auth …）
2. 在 </body> 前依次注入：
   <script id="pv-anyedit-data">   空数据占位（任意编辑器的改动快照）
   <script id="pv-notes-data">     空数据占位（批注 / 就地编辑记录）
   <script id="pv-anyedit-module"> 任意元素编辑器本体（pv-anyedit.js）
   <script id="pv-notes-module">   批注 + 就地编辑 + 保存链本体（pv-notes.js）
   <script id="pv-mode-module">    右上角「阅读 / 编辑」模式开关（pv-mode.js）

幂等：重复运行会先移除旧的注入块再加回去，不会叠加。
"""
import argparse
import io
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))

EDITOR_CSS = u"""
/* ================= pv-editable-html：任意元素编辑器 ================= */
#pvanyedit-ui{position:fixed;z-index:2147483000;font-family:Arial,"Microsoft YaHei",sans-serif;font-size:12px;line-height:1.4}
#pvanyedit-ui *{box-sizing:border-box}
.pae-btn{display:inline-flex;align-items:center;gap:4px;padding:5px 10px;border-radius:16px;border:1px solid #c9ced3;background:#fff;color:#092C61;cursor:pointer;font-size:12px;font-family:inherit;white-space:nowrap}
.pae-btn:hover{background:#eaf1fa;border-color:#7297C5}
.pae-btn.on{background:#092C61;color:#fff;border-color:#092C61}
.pae-toggle{position:fixed;right:16px;bottom:58px;box-shadow:0 3px 14px rgba(9,44,97,.22);z-index:2147482999}
.pae-save{position:fixed;right:16px;bottom:96px;box-shadow:0 3px 14px rgba(9,44,97,.22);z-index:2147482999;background:#159788;border-color:#159788;color:#fff}
.pae-save:hover{background:#0f7a6e;border-color:#0f7a6e}
.pae-auth{position:fixed;right:16px;bottom:134px;box-shadow:0 3px 14px rgba(9,44,97,.22);z-index:2147482999;background:#E0731A;border-color:#E0731A;color:#fff;font-weight:700}
.pae-auth:hover{background:#c2620f;border-color:#c2620f}
.pae-toolbar{position:fixed;display:none;align-items:center;gap:5px;flex-wrap:wrap;max-width:min(940px,96vw);padding:6px 8px;border-radius:10px;background:#fff;border:1px solid #c9ced3;box-shadow:0 6px 22px rgba(9,44,97,.22)}
.pae-toolbar.show{display:flex}
.pae-name{font-weight:700;color:#092C61;max-width:190px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pae-hint{color:#727375;font-size:11px}
.pae-sep{width:1px;height:18px;background:#e2e5e8;margin:0 2px}
.pae-inp{width:56px;padding:4px 6px;border:1px solid #c9ced3;border-radius:6px;font-size:12px;font-family:inherit;color:#1c1c1e;background:#fff}
.pae-inp.wide{width:94px}
.pae-swatch{width:22px;height:22px;border-radius:50%;border:2px solid #fff;box-shadow:0 0 0 1px #c9ced3;cursor:pointer;display:inline-block}
.pae-hl{outline:2px dashed #E0731A !important;outline-offset:2px}
[data-pae-sel]{filter:drop-shadow(0 0 4px #E0731A)}
.pae-hl2{outline:2px solid #7297C5 !important;outline-offset:2px}
.pae-toast{position:fixed;left:50%;transform:translateX(-50%);bottom:78px;background:rgba(9,44,97,.94);color:#fff;padding:7px 14px;border-radius:16px;font-size:13px;z-index:2147483600}
[contenteditable="true"]{outline:2px solid #159788 !important;background:#e6f4f2}
.pae-fs{position:fixed;display:none;align-items:center;gap:3px;padding:3px 5px;border-radius:14px;background:#fff;border:1px solid #c9ced3;box-shadow:0 3px 12px rgba(9,44,97,.28);z-index:2147483500}
.pae-fs.show{display:inline-flex}
.pae-fs-flush{background:rgba(255,255,255,.94);box-shadow:0 3px 14px rgba(9,44,97,.30);border-color:#7297C5}
.pae-fsbtn{font-family:inherit;font-size:12.5px;font-weight:700;color:#092C61;background:#eaf1fa;border:1px solid #c9ced3;border-radius:10px;padding:2px 9px;cursor:pointer;line-height:1.5}
.pae-fsbtn:hover{background:#092C61;color:#fff;border-color:#092C61}
.pae-fsval{min-width:40px;text-align:center;font-size:11.5px;color:#727375}
.pae-drop{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);display:none;padding:22px 30px;border:3px dashed #E0731A;border-radius:14px;background:rgba(255,255,255,.97);color:#092C61;font-size:17px;font-weight:700;z-index:2147483600;box-shadow:0 10px 40px rgba(9,44,97,.3);text-align:center;max-width:70vw}
.pae-drop.show{display:block}
.pae-firstrun,#pae-firstrun{position:fixed;left:50%;transform:translateX(-50%);bottom:70px;z-index:2147483300;display:flex;align-items:center;gap:10px;max-width:min(940px,94vw);padding:9px 14px;border-radius:12px;background:#fff;border:2px solid #E0731A;box-shadow:0 6px 24px rgba(9,44,97,.25);font-size:13.5px;color:#092C61;font-family:Arial,"Microsoft YaHei",sans-serif;line-height:1.5}
@media print{#pae-firstrun{display:none!important}}
.pae-sandbox,#pae-sandbox{position:fixed;left:50%;transform:translateX(-50%);top:60px;z-index:2147483350;display:flex;align-items:center;gap:10px;max-width:min(960px,94vw);padding:10px 14px;border-radius:12px;background:#fff;border:2px solid #C2170A;box-shadow:0 6px 24px rgba(9,44,97,.28);font-size:13.5px;color:#092C61;font-family:Arial,"Microsoft YaHei",sans-serif;line-height:1.5}
@media print{#pae-sandbox{display:none!important}}
@media print{#pvanyedit-ui,.pae-drop{display:none!important}}
/* ================= /pv-editable-html ================= */
"""

MARK_EDITOR_CSS = u'/* ================= pv-editable-html'


def read(p):
    with io.open(p, encoding='utf-8') as f:
        return f.read()


def write(p, s):
    d = os.path.dirname(os.path.abspath(p))
    if d and not os.path.isdir(d):
        os.makedirs(d)
    with io.open(p, 'w', encoding='utf-8') as f:
        f.write(s)


BLOCK_IDS = ('pv-anyedit-data', 'pv-notes-data', 'pv-anyedit-module', 'pv-notes-module', 'pv-mode-module')


def strip_scripts(html):
    """精确移除本工具注入的脚本块。

    ⚠️ 千万不要用 `<script id="X">.*?</script>` 这种非贪婪正则：模块源码的头部注释里
    本身就含 </script> 字面量（pv-notes.js 的注释里就写着注入格式），正则会在注释中间
    截断，把文件结构搞坏 —— 实测会残留两个 </body>、模块被加载两次。
    所以改成**正向扫描**：按出现顺序把 `<script …> … </script>` 一块块切出来，
    开标签 id 命中本工具清单就丢掉，否则原样保留。
    为什么不能用「从 </body>往前 rfind('<script')」的倒退法：模块源码里本身就含
    `<script` 字面量（pv-notes.js 里有一句正则 `/<script[^>]*id="pv-notes-data"…/`），
    倒退时会先撞上它，匹配错位、只删掉最后一块（实测：重复运行会让文件膨胀一倍）。
    正向扫描不会踩这个坑 —— 那些假 `<script` 都位于某个真实脚本块内部，会被整块跳过。
    """
    out = []
    i = 0
    n = len(html)
    while i < n:
        j = html.find('<script', i)
        if j < 0:
            out.append(html[i:])
            break
        gt = html.find('>', j)
        if gt < 0:
            out.append(html[i:])
            break
        close = html.find('</script>', gt)
        if close < 0:
            out.append(html[i:])
            break
        close += len('</script>')
        open_tag = html[j:gt + 1]
        if any(('id="%s"' % b) in open_tag for b in BLOCK_IDS):
            out.append(html[i:j])
            if close < n and html[close] == '\n':
                close += 1                 # 块尾换行属于注入块，一起吃掉（保证字节级幂等）
        else:
            out.append(html[i:close])      # 用户自己的脚本：原样保留
        i = close
    return ''.join(out)


def strip_previous(html):
    """幂等：清掉上一轮注入的块与 CSS（连注入时加的前导换行一起清，保证字节级幂等）。"""
    html = strip_scripts(html)
    i = html.find(MARK_EDITOR_CSS)
    if i >= 0:
        start = i - 1 if i > 0 and html[i - 1] == '\n' else i
        j = html.find('/* ================= /pv-editable-html ================= */', i)
        if j > 0:
            j = html.find('\n', j)
            html = html[:start] + html[j + 1:]
    return html


def assemble(parts_dir):
    files = sorted(f for f in os.listdir(parts_dir) if f.lower().endswith('.html'))
    if not files:
        raise SystemExit('片段目录里没有 .html：%s' % parts_dir)
    return '\n'.join(read(os.path.join(parts_dir, f)) for f in files)


def build(html, editor_js, notes_js, mode_js):
    html = strip_previous(html)

    # 1) CSS
    k = html.rfind('</style>')
    if k < 0:
        raise SystemExit('找不到 </style>：请确认输入文件自带样式表，或先把 CSS 内联进 <head>')
    html = html[:k] + EDITOR_CSS + html[k:]

    # 2) 三层脚本，插在 </body> 之前（注意用 rfind：模块源码里可能含 "</body>" 字样）
    i = html.rfind('</body>')
    if i < 0:
        raise SystemExit('找不到 </body>')
    block = (
        u'<script id="pv-anyedit-data" type="application/json">{}</script>\n'
        u'<script id="pv-notes-data" type="application/json">{}</script>\n'
        u'<script id="pv-anyedit-module">\n' + editor_js + u'\n</script>\n'
        u'<script id="pv-notes-module">\n' + notes_js + u'\n</script>\n'
        u'<script id="pv-mode-module">\n' + mode_js + u'\n</script>\n'
    )
    return html[:i] + block + html[i:]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src', nargs='?', help='源 HTML')
    ap.add_argument('out', nargs='?', help='输出 HTML')
    ap.add_argument('--parts', help='片段目录（与 src 二选一）')
    ap.add_argument('--assets', default=os.path.join(HERE), help='pv-anyedit.js / pv-notes.js 所在目录')
    a = ap.parse_args()

    if a.parts:
        if not a.out:
            raise SystemExit('用法：build_panel.py --parts <目录> <输出.html>')
        html = assemble(a.parts)
    else:
        if not a.src or not a.out:
            ap.print_help()
            raise SystemExit(2)
        html = read(a.src)

    editor_js = read(os.path.join(a.assets, 'pv-anyedit.js'))
    notes_js = read(os.path.join(a.assets, 'pv-notes.js'))
    mode_js = read(os.path.join(a.assets, 'pv-mode.js'))
    assert '</script' not in editor_js.lower(), 'pv-anyedit.js 含 </script 字面量，请检查'
    assert '</script' not in notes_js.lower(), 'pv-notes.js 含 </script 字面量，请检查'
    assert '</script' not in mode_js.lower(), 'pv-mode.js 含 </script 字面量，请检查'

    out = build(html, editor_js, notes_js, mode_js)
    write(a.out, out)
    print('OK -> %s  (%d chars)' % (a.out, len(out)))
    print('注入块：pv-anyedit-data x%d, pv-anyedit-module x%d, pv-notes-data x%d, pv-notes-module x%d, pv-mode-module x%d' % (
        out.count('<script id="pv-anyedit-data"'), out.count('id="pv-anyedit-module"'),
        out.count('<script id="pv-notes-data"'), out.count('id="pv-notes-module"'),
        out.count('id="pv-mode-module"')))
    # 结构校验：注入块必须落在最后一个 </body> 之前，且 </body> 之后只有 </html>。
    # （不能用 count('</body>')==1 判定：模块源码的注释里本身就含该字面量。）
    if out.rstrip().split('</body>')[-1].strip() != '</html>':
        raise SystemExit('❌ 注入后文件尾部结构异常（</body> 之后不是 </html>），请检查源文件')
    if out.count('</body>') != html.count('</body>'):
        sys.stderr.write('⚠️ 注入块的源码注释含 </body> 字面量，计数不可用作结构判据（已改用尾部结构校验）\n')


if __name__ == '__main__':
    main()
