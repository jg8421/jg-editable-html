<#
patch-dsh-reveal.ps1 —— 修复「在资源管理器中打开」对中文路径失效

症状
----
在 DSH Web GUI 里点「在资源管理器中打开」，什么都不弹，
或者弹出的却是「桌面」/「文档」，而不是文件真正所在的文件夹。

根因（DSH 自身的问题，与你的 HTML 无关）
---------------------------------------
@deepseek-ai/dsh-native-command 的 revealNativePath 在 Windows 上执行的是：

    execFile("explorer.exe", ["/select,", pathToFileURL(path).href])

把路径转成百分号编码的 file:// URL，再拆成两个参数交给 explorer。
当路径含 中文 / 全角字符（【】（））/ 空格 时 Explorer 解析失败，
静默退回"桌面"或"文档"。实测：简单英文名三种写法都行；
中文名只有"PowerShell + /select,\"纯路径\""这一种稳定命中。

修复
----
改用 PowerShell（与同文件 openNativePath 的做法一致）：

    powershell.exe -NoProfile -Command ^
      Start-Process explorer.exe -ArgumentList ('/select,"' + <纯路径> + '"')

用法
----
    powershell -NoProfile -ExecutionPolicy Bypass -File patch-dsh-reveal.ps1
    powershell ... -File patch-dsh-reveal.ps1 -RuntimeRoot "D:\path\to\deepseek-harness-runtime"
    powershell ... -File patch-dsh-reveal.ps1 -Restore     # 还原
    powershell ... -File patch-dsh-reveal.ps1 -Check       # 只看状态，不改

注意
----
1. 改完必须**重启 DSH**（node 进程已缓存旧模块），否则不生效。
2. `pnpm install` 或升级 DSH 会还原这个文件 —— 重跑本脚本即可。
3. 备份写在同目录 `index.js.orig-dsh`。
#>
[CmdletBinding()]
param(
  [string]$RuntimeRoot = '',
  [switch]$Restore,
  [switch]$Check
)

$ErrorActionPreference = 'Stop'

function Find-Target([string]$root){
  $pnpm = Join-Path $root 'node_modules\.pnpm'
  if(-not (Test-Path -LiteralPath $pnpm)){ return $null }
  return Get-ChildItem -LiteralPath $pnpm -Directory -ErrorAction SilentlyContinue |
         Where-Object { $_.Name -like '*dsh-native-com*' } |
         ForEach-Object { Join-Path $_.FullName 'node_modules\@deepseek-ai\dsh-native-command\lib\index.js' } |
         Where-Object { Test-Path -LiteralPath $_ } |
         Select-Object -First 1
}

# ---------- 定位 runtime ----------
$target = $null
if($RuntimeRoot){ $target = Find-Target $RuntimeRoot }

if(-not $target){
  # 从正在运行的 dsh 进程反查（最可靠）
  try{
    $p = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
         Where-Object { $_.CommandLine -and $_.CommandLine -match 'dsh' -and $_.CommandLine -match 'bin\.js' } |
         Select-Object -First 1
    if($p -and $p.CommandLine -match '([A-Za-z]:\\[^"]*?)\\node_modules\\\.bin\\'){ $target = Find-Target $Matches[1] }
    if(-not $target -and $p -and $p.CommandLine -match '"([A-Za-z]:\\[^"]*?)\\node_modules\\'){ $target = Find-Target $Matches[1] }
  }catch{}
}

if(-not $target){
  # 兜底：在常见位置浅层搜索
  $seeds = @("$env:USERPROFILE\Documents\Codex", "$env:USERPROFILE\Documents", "$env:USERPROFILE")
  foreach($s in $seeds){
    if(-not (Test-Path -LiteralPath $s)){ continue }
    $hits = Get-ChildItem -LiteralPath $s -Directory -Recurse -Depth 4 -Filter 'deepseek-harness-runtime' -ErrorAction SilentlyContinue | Select-Object -First 1
    if($hits){ $target = Find-Target $hits.FullName; if($target){ break } }
  }
}

if(-not $target){
  throw "找不到 dsh-native-command\lib\index.js。请用 -RuntimeRoot 指定 deepseek-harness-runtime 目录。"
}

$bak = "$target.orig-dsh"
$src = [IO.File]::ReadAllText($target)
$patched = $src.Contains('FIX(local)')

if($Check){
  "目标文件 : $target"
  "是否已打补丁 : " + $(if($patched){ '是' } else { '否' })
  "备份存在 : " + (Test-Path -LiteralPath $bak)
  return
}

if($Restore){
  if(-not (Test-Path -LiteralPath $bak)){ throw "没有备份文件 $bak，无法还原" }
  Copy-Item -LiteralPath $bak -Destination $target -Force
  "已还原：$target"
  "★ 重启 DSH 后生效。"
  return
}

if($patched){ "已经打过补丁，无需重复。"; "  文件：$target"; "  （若仍未生效，请重启 DSH）"; return }

$old = @'
		const target = pathToFileURL(windowsPath, { windows: true }).href.replaceAll(",", "%2C");
		try {
			await run("explorer.exe", ["/select,", target], signal);
		} catch (error) {
			signal.throwIfAborted();
			if (!(error instanceof Error) || !("code" in error) || error.code !== 1) throw error;
		}
		return;
'@

$new = @'
		/* FIX(local): 直接把 "/select," 与 file:// URL 交给 explorer.exe，在路径含
		   中文 / 全角字符（【】（））/ 空格时会解析失败，Explorer 静默退回"桌面"或"文档"，
		   用户看到的就是"点了没反应"。改用 PowerShell 以单个参数 /select,"<纯路径>" 唤起，
		   与同文件 openNativePath 走 PowerShell 的做法一致。实测命中率 100%。 */
		if (platform === "win32") {
			await run("powershell.exe", [
				"-NoProfile",
				"-Command",
				`Start-Process explorer.exe -ArgumentList ('/select,"' + ${powershellLiteral(windowsPath)} + '"')`
			], signal);
			return;
		}
		const target = pathToFileURL(windowsPath, { windows: true }).href.replaceAll(",", "%2C");
		try {
			await run("explorer.exe", ["/select,", target], signal);
		} catch (error) {
			signal.throwIfAborted();
			if (!(error instanceof Error) || !("code" in error) || error.code !== 1) throw error;
		}
		return;
'@

$old = $old -replace "`r`n", "`n"
$new = $new -replace "`r`n", "`n"
$srcLf = $src -replace "`r`n", "`n"

if(-not $srcLf.Contains($old)){ throw "源码结构与预期不符（可能已升级），请人工检查：$target" }

Copy-Item -LiteralPath $target -Destination $bak -Force
[IO.File]::WriteAllText($target, $srcLf.Replace($old, $new), (New-Object Text.UTF8Encoding($false)))

"补丁已应用："
"  文件：$target"
"  备份：$bak"
""
"★ 必须重启 DSH 才生效（node 进程缓存了旧模块）。"
"★ pnpm install / 升级 DSH 后重跑本脚本即可。"
