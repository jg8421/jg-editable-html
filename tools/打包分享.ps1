<#
打包分享.ps1 —— 把"面板 HTML + 保存助手 + 收件人说明"打成一个 zip，方便发给同事

同事拿到 zip 后：
  1. 解压
  2. 双击 pv-save-helper\启动保存助手.cmd（一次，可最小化）
  3. 打开 HTML，Ctrl+S 就是零弹窗直接覆盖
（不启动助手也能用：Ctrl+S 会下载一份改好的副本，发回给你即可）

用法：
  powershell -NoProfile -ExecutionPolicy Bypass -File 打包分享.ps1
  powershell ... -File 打包分享.ps1 -Html "xxx.html" -Out "xxx_分享包.zip"
#>
[CmdletBinding()]
param(
  [string]$Html = '',
  [string]$Out  = ''
)

$ErrorActionPreference = 'Stop'
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$HelperDir = Join-Path $Here 'pv-save-helper'

# 1) 找面板 HTML（默认取本目录下最新修改的那个，排除副本）
if(-not $Html){
  $cand = Get-ChildItem -LiteralPath $Here -Filter *.html -File |
          Where-Object { $_.Name -notlike '*副本*' -and $_.Name -notlike '_*' } |
          Sort-Object LastWriteTime -Descending
  if(-not $cand){ throw "本目录下没找到 HTML" }
  $Html = $cand[0].FullName
}
if(-not (Test-Path -LiteralPath $Html)){ throw "找不到 HTML：$Html" }
$Html = (Resolve-Path -LiteralPath $Html).Path
$base = [IO.Path]::GetFileNameWithoutExtension($Html)

# 2) 临时打包目录
$stage = Join-Path $env:TEMP ("sharepack_" + [guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Force -Path $stage | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $stage 'pv-save-helper') | Out-Null

Copy-Item -LiteralPath $Html -Destination $stage
Copy-Item -Path (Join-Path $HelperDir '*') -Destination (Join-Path $stage 'pv-save-helper') -Recurse -Force
foreach($n in @('可批注HTML_收件人一页说明.md')){
  $f = Join-Path $Here $n
  if(Test-Path -LiteralPath $f){ Copy-Item -LiteralPath $f -Destination $stage }
}

# 3) 给同事看的一页说明
$readme = @"
# 怎么用这份文件

## 只想看 / 只改文字（不用装任何东西）

1. 双击打开 **$([IO.Path]::GetFileName($Html))**
2. 右上角把「阅读 ｜ 编辑」切到 **编辑**，就能改任意文字、删表格、调字号
3. 改完按 **Ctrl+S** —— 会自动下载一份改好的副本（**不弹任何窗口**）
4. 把下载到的那份**发回给作者**即可

## 想让它"Ctrl+S 直接覆盖原文件"（零弹窗）

1. 双击 **pv-save-helper\启动保存助手.cmd**（弹出一个黑窗口，最小化放着就行）
2. 之后 Ctrl+S 就是**直接覆盖、不弹窗**
3. 关掉那个窗口即停止，不会留任何东西在后台

> 助手只监听本机 127.0.0.1，只允许写这个文件夹里的 .html 文件，
> 而且只覆盖已存在的文件 —— 不会新建、不会碰别的地方。
"@
[IO.File]::WriteAllText((Join-Path $stage '先读我.md'), $readme, (New-Object Text.UTF8Encoding($false)))

# 4) 压缩
if(-not $Out){ $Out = Join-Path $Here ($base + '_分享包.zip') }
if(Test-Path -LiteralPath $Out){ Remove-Item -LiteralPath $Out -Force }
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $Out -Force
Remove-Item -Recurse -Force $stage

"已生成分享包："
"   $Out"
"   （$([math]::Round((Get-Item -LiteralPath $Out).Length/1KB,1)) KB）"
""
"包内："
"   $([IO.Path]::GetFileName($Html))    ← 面板"
"   pv-save-helper\            ← 保存助手（同事双击一次即可零弹窗）"
"   先读我.md                  ← 给同事的一页说明"
