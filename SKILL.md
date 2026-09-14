---
name: pv-editable-html
description: 把单文件 HTML 面板做成「既能看、又能批注、任意元素可改、Ctrl+S 就地覆盖保存」的交付物；含完整施工 SOP、注入脚本、自检脚本与全部踩过的坑。用于：用户 要一个可直接改的 HTML（研究面板 / IC 讨论稿 / 专家纪要 / 行业研究 / 一页纸）、要做能转发给同事并收回批注的 HTML、要"像 Word 一样改这个网页"。触发词：可编辑 HTML、可批注 HTML、HTML 怎么改、保存 HTML、Ctrl+S 保存、单文件面板、all in one HTML、任意元素编辑、字号调不了、另存为弹窗、HTML 交付。
---

# pv-editable-html · 可编辑 + 可批注 + 可就地保存的单文件 HTML

## 0. 一句话

**输入**任意单文件 HTML（自带 `<style>` 与 `</style>`）→ **输出**同一个文件，但多了一层能力：
打开就能点任意元素改字/改字号/改宽高/删元素/调顺序、选中文字加批注、**Ctrl+S 直接覆盖保存回原文件**。
**全程只有一个文件**，发给谁都能打开、都能改、都能存回来。

## 1. 什么时候用

- 用户说「搞个 HTML」「做个面板」，并且**大概率会自己要改**（研究面板、IC 讨论稿、专家纪要、行业研究、一页纸）→ **默认就带上这一层，不用等他开口。**
- 用户说「这个 HTML 不好改」「加个批注」「要能保存」「Ctrl+S」→ 直接按本技能执行。
- 例外：他明确说「只要只读版」。

## 2. 两步交付（最少命令）

```bash
# ① 生成可编辑版（在 assets 目录里跑）
python build_panel.py content.html out.html
#   或者由片段拼装：
python build_panel.py --parts <片段目录> out.html

# ② 交付前自检（必须跑，全绿才算完成）
python verify_panel.py out.html
```

要求：`content.html` 必须是**完整 HTML**（有 `<head><style>…</style></head><body>…</body>`）。
`build_panel.py` 会在 `</style>` 前插 CSS、在 `</body>` 前插四块 script（`pv-anyedit-data`、`pv-notes-data`、`pv-anyedit-module`、`pv-notes-module`）。**幂等**，可反复跑。

> 内容型面板的排版规则（中英并列、黄框结论、字号基线、SVG 图表写法等）见 项目内的 项目内的排版规范文档，本技能只管"可编辑/可保存"这一层。

## 3. 产出后用户会看到什么

| 位置 | 控件 | 作用 |
|---|---|---|
| 右下角 | **✎ 任意编辑：开/关** | 默认**开**。开着时点任意元素 → 浮出工具条 |
| 右下角 | **💾 保存** | 覆盖保存当前文件（等同 Ctrl+S） |
| 右下角 | **📁 授权文件夹（一次）** | 授权一次后**整个文件夹永久免弹窗**；已授权时自动隐藏 |
| 元素右侧 | **A− 15.5px A+** | 鼠标划过某段文字时出现；**点选该元素后按钮会"钉住"**，鼠标挪过去也不消失 |
| 选中后 | 工具条 | 字号/字体/宽高/内外距/文字色/底色/⬆⬇排序/复制/改源码/撤销/删除 |
| 键盘 | `Delete`/`Backspace` | 删除选中元素，**其余元素自动补位**（网格列数自适应） |
| 键盘 | `Ctrl+Z` / `Esc` | 撤销 / 取消选中 |
| 键盘 | `Ctrl+S` | 保存（**不弹窗**，前提是已授权） |
| 右缘 | **批注** 竖标签 | 选中文字 → ＋批注；抽屉里可定位/标已处理/删除/导入合并/导出 .md |

## 4. 十条**不可协商**的规则（都是踩过的坑）

1. **编辑器默认必须是「开」**。默认关 = 用户点一下没反应 = "没法编辑"。
2. **默认开就必须做穿透白名单**：`nav#tabs`、`.pager`、`#hint`、`details > summary`、`[data-goto]` 一律放行（否则导航点不动）；**Alt+点击**才强制选中它们。
3. **hover 型浮动控件必须支持"点选钉住 + 祖先不抢目标 + 延迟隐藏"**这三件套，否则用户永远点不中它（鼠标从文字走向按钮时经过外层容器，控件会跳走/消失）。
4. **任意元素都要能改字**（含 `<li>` 这种内含 `<b>` 的容器）：直接给该元素加 `contenteditable`，不要只允许"叶子元素"；同时 `onClick` 里 `if(EDITING && EDITING.contains(t)) return;`，否则在容器内点一下放光标会被当成重新选中。
5. **删除要能自动补位、还要能撤销**：网格容器删除子元素后把 `grid-template-columns` 收紧到 `min(原始列数, 剩余数)`（原始列数存在 `data-pae-cols` 上，否则撤销回不去）；撤销要用 **DOM 引用**（`{node,parent,idx,next}`）插回，并同时清 `hidden` 记录、重存冻结快照。
6. **JS 渲染出来的内容是"改不动"的根因**，必须用**冻结机制**：任何结构/样式改动都把**最近的带 id 祖先**的 `innerHTML` 存进 `pv-anyedit-data.frozen`，boot 时 `applyFrozen()` 在面板渲染**之后**塞回，再用 MutationObserver 兜底。
7. **导出前必须洗快照**：`frozen` 快照是在编辑当下抓的，里面混着 `pae-hl` / `data-pae-sel` / `contenteditable` 这些编辑器临时状态 —— 不洗掉，保存出来的文件重开后会出现**永远擦不掉的橙色虚线框**。
8. **保存前必须把编辑器自己的 UI 摘掉**：临时移除 `#pvanyedit-ui`、`.pae-toast`、`.pae-drop`，清掉高亮类，再调批注模块的 `buildOutput()`，最后挂回。**并且要给 `PVNotes.buildOutput` 打补丁**（任何人从批注抽屉点保存也不会把工具条烘进文件）。
9. **保存一律"就地覆盖、尽量零弹窗"**：优先用已授权的**文件夹句柄**（一次授权覆盖整个文件夹）→ 已记住的**文件句柄** → 都没有才弹一次 `showSaveFilePicker`，且必须传 `id`（让 Chrome 记住目录）、`suggestedName`（当前文件名）、`startIn`（已知句柄）。**把 `showSaveFilePicker` 全局包一层**，保证任何调用方都享受到这些默认值。
10. **从存储里读回来的句柄是不可信输入**：用前校验 `typeof h.getFileHandle === 'function'` / `typeof h.createWritable === 'function'`；并且任何带状态标志（`SAVING`）的异步流程都要**同步 try/catch 兜底复位**，否则一次同步异常就会把按钮永久卡在"保存中…"。

11. **★ 第一次保存要弹窗时，`showSaveFilePicker` 必须在用户手势内"同步"调用 —— 中间不能 `await` 任何东西（哪怕是读 IndexedDB）。**
   浏览器给的用户手势窗口只有几秒；如果先 `await idbGet(...)`（IndexedDB 打开最坏 1.5s 甚至更久）再弹窗，手势已过期 → Chrome 抛 `SecurityError: Must be handling a user gesture` → **表现就是"按了 Ctrl+S 但文件根本没更新"**（用户还会以为是自己没保存，实际代码静默失败了）。
   **正确做法**：**在 boot 阶段就把文件句柄与目录句柄预读进内存变量**（`loadFileHandle()` / `loadDir()` 放进已有的轮询里），Ctrl+S 时直接判断内存变量：
   - 有句柄 → 异步静默写（不需要手势）；
   - **没有句柄 → 立刻同步调 `showSaveFilePicker()`**，把 IDB 读写放到 `.then()` 之后。
   并把 `SecurityError` / "user gesture" 单独 catch 出来，提示用户"点右下角「💾 保存」按钮一次即可"（点击手势窗口更宽裕）。
   **验证方法**：stub `PVNotes._idbGet` 返回一个 **1.4s 才 resolve** 的 Promise，记录 `performance.now()`，断言 `picker` 的调用时间戳与 `keydown` 派发时间**相差 ≈ 0ms**。

12. **工具条必须用 `position:fixed` + 视口坐标定位。** 编辑器的浮层容器 `#pvanyedit-ui` 本身是 `position:fixed` 但**没有 top/left**，它的静态位置在文档末尾；此时若工具条写成 `position:absolute` 并用"文档坐标"（`pageYOffset + rect.top`）定位，**工具条会被放到文档几万像素处 —— 看起来就是"点了没反应"**。正确写法：工具条 `position:fixed`，`top = rect.top - barH - 6`（放不下就翻到元素下方），再按视口宽高钳制。`verify_panel.py` 已内置这项断言（会打印 `toolbar = inside-viewport:…`）。
13. **若面板带「阅读 / 编辑」模式开关（`pv-mode.js`，默认阅读模式）**，自检与截图都要**先切到编辑模式**再断言工具条/浮动按钮；否则会得到一堆"看不见"的假失败。

## 5. 交付前必须跑的检查

`verify_panel.py` 会自动跑完并就 FAIL 给出退出码 1：

- `node --check` 每个 `<script>`
- headless Chrome `--dump-dom` 渲染，**`#jserr` 必须为空**
- **`#pvanyedit-ui` 数量必须恰好 1**（>1 = 编辑器 UI 被烘进了文件）
- `#pv-anyedit-data` / `#pv-notes-data` 存在
- **SVG 文字：越界 0 处、标签重叠 0 处**（用估宽算法，CJK=fs×1.02 / ASCII=fs×0.58）
- **浮动控件自击测试**：`elementFromPoint(控件中心)` 必须返回控件自己或其后代（否则就是被遮挡）

人工再补两步（`verify_panel.py` 覆盖不到）：

- **保存链路**：stub 掉 `showSaveFilePicker` / `showDirectoryPicker` / `prompt`，把每次调用记进数组；断言"点保存 / Ctrl+S → 弹窗 0 次、写入恰好 1 次、产物里 `indexOf('<div id="pvanyedit-ui"') === -1`"。
- **首次保存的同步性**：stub `PVNotes._idbGet` 为 1.4s 才 resolve，断言 `showSaveFilePicker` 与 `keydown` 的时间差 **≈ 0ms**（不能被 IDB 拖出手势窗口）。
- **另存文件可重开**：把写出去的那份 HTML 塞进 `<iframe srcdoc>` 真加载一遍，断言 `#pvanyedit-ui` 恰好 1 个、刚才的编辑生效、章节数/图表数不变、无报错。

## 6. 六个会让检查"假通过/假失败"的陷阱

1. **探针源码自己会被命中**：在这个"模块源码就在页面里"的文件上，`indexOf('pvanyedit-ui')`、`indexOf('data-pae="toggle"')` **永远为真**。要断言"UI 没被烘进文件"必须查**运行时在重新加载的文档里 `querySelectorAll` 的个数**，或者查 `<div id="pvanyedit-ui"` 这种**只在渲染后 DOM 里才有的整串**——而且**探针自己不能把这个字面量写出来**（要拼字符串）。
2. **★ Python 三引号会吃掉 JS 的转义，导致探针"静默不执行"**：非 raw 的三引号里写 `out.push(x + '\n')`，Python 会把 `\n` 变成**真换行**，注入的 `<script>` 里就出现字符串字面量跨行 → **整个探针脚本语法错误、什么都不输出**；你只会看到"探针内容为空"，根本不会怀疑到转义上（本轮真踩过，排查花了很久）。
   **两条硬规则**：① 探针一律用 `r"""..."""` **原始字符串**；② JS 里**避免反斜杠**，用 `String.fromCharCode(9)` / `String.fromCharCode(10)` 代替 `\t` `\n`。另外探针要**每检查一项就立刻写入 DOM**（`pre.textContent += ...`），并给每一项套 `try/catch` —— 否则中途一抛异常，前面所有结果一起丢。
3. **`resize`/`scroll`/`mouseleave` 里的"清理型"监听器会让 headless 截图永远拍不到东西**：headless 截图前会 resize 一次视口。这类监听器只能**重新定位**，不能隐藏。
4. **`<script>` 和 `</body>` 都要用 `rfind` 插入**：模块源码的中文注释里本身就含 `</body>` 字样，`str.replace` 默认全局替换会把它截断（探针自己的 `</script>` 会提前闭合模块）。
5. **headless 里 IndexedDB 不可靠**（`--virtual-time-budget` 虚拟化定时器、IDB 走真实 I/O，`idbPut` 可能返回 0）：测句柄通道请**直接 stub `PVNotes._idbGet` 返回假句柄**，不要试图真写 IDB。
6. **`window.scrollTo(x, y)` 两参数形式同样受 CSS `scroll-behavior` 影响**：headless 里验证滚动要同时注入 `html{scroll-behavior:auto !important}` 与 `matchMedia('(prefers-reduced-motion)')` 桩。

## 7. 关于"第一次保存为什么要授权"

`file://` 页面也是网页，**浏览器不允许网页未经允许写磁盘**，而且**磁盘路径字符串无法变成可写句柄**。
所以"第一次"一定有成本，能做的是把它降到最低 —— 在给用户的说明里要**如实讲清楚**，不要含糊：

1. **推荐**：点一次「📁 授权文件夹（一次）」→ 之后**该文件夹下所有文件**静默覆盖，永不弹窗；
2. **或者**：把当前 HTML **拖进页面**（`DataTransferItem.getAsFileSystemHandle()`）→ 零弹窗，仅对这一个文件有效（务必校验文件名一致，防止写到别的文件）；
3. **兜底**：什么都不做直接 Ctrl+S → 弹一次"另存为"，但目录与文件名都已配好。

## 8. 交付话术

把文件发出去时，**连 `assets/收件人一页说明.md` 一起发**，并主动告知两件事：

1. 想删表格/调顺序要先确保「✎ 任意编辑」是开着的，点元素 → 工具条；
2. 第一次 Ctrl+S 弹一次授权框（选一次文件夹），之后不会再弹。

## 9. 目录结构

```
pv-editable-html/
├─ SKILL.md                     ← 本文件
├─ README.md                    ← 部署到其他机器 / 其他 Agent 的方法
├─ assets/
│  ├─ build_panel.py            ← 一键生成可编辑版（含编辑器 CSS 注入）
│  ├─ verify_panel.py           ← 一键自检（渲染 / 越界 / 重叠 / 遮挡 / 工具条位置）
│  ├─ pv-anyedit.js             ← 任意元素编辑器（零依赖）
│  ├─ pv-notes.js               ← 批注 / 就地编辑 / 保存链（零依赖）
│  ├─ pv-mode.js                ← 右上角「阅读 / 编辑」模式开关 + 浮动按钮兜底
│  ├─ inject_pvnotes.py         ← 只注入批注层（已有面板补批注时用）
│  └─ 收件人一页说明.md          ← 随文件转发给阅读者
├─ references/
│  └─ 实现原理与上手手册.md      ← 三层架构、锚点算法、保存链、全部实现细节
└─ template/
   └─ minimal-example.html      ← 最小可用样例（可直接改内容）
```

## 10. 换一台机器 / 换一个 Agent 怎么用

```powershell
# 把整个 pv-editable-html 文件夹放到目标机的技能目录即可
# 方式一：软链到 OneDrive 上的分发源（推荐，多机同步）
cmd /c mklink /J "%USERPROFILE%\.dsh\skills\pv-editable-html" "<OneDrive>\<技能分发目录>\skills\pv-editable-html"
# 方式二：直接拷贝
Copy-Item -Recurse <OneDrive>\...\skills\pv-editable-html "$env:USERPROFILE\.dsh\skills\"
```

依赖：**Python 3**（脚本用标准库）+ 本机 **Chrome**（自检用）+ **Node**（可选，语法检查用）。
两个 JS 模块**零依赖**，不需要网络、不需要 CDN。
