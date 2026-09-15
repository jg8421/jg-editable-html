<#
pv-save-helper.ps1 —— 本地保存助手（零弹窗写盘）

为什么需要它：浏览器禁止网页直接写磁盘，第一次必须弹窗授权，而且网页无从得知
"我这个文件在哪个文件夹"（Chrome 没有 getParent()，也没有"路径 → 句柄"的 API）。
本助手在本机 127.0.0.1 上开一个只服务本机的端口：面板 Ctrl+S 时把内容 POST 过来，
它按"页面当前路径"直接写回原文件 —— 不弹任何窗口，也不需要按回车。

安全边界（故意做得很窄）：
  1. 只监听 127.0.0.1（外部访问不到）
  2. 只接受 .html / .htm 文件
  3. 只允许写 -Roots 里列出的目录（默认 = 本脚本所在目录的上一级）
  4. 目标文件必须"已经存在"（只覆盖、不新建）
  5. 原子写：先写 .tmp 再 Move-Item -Force
  6. 纯被动监听，没有轮询、没有后台循环；关掉窗口即停止

用法：
  powershell -NoProfile -ExecutionPolicy Bypass -File pv-save-helper.ps1
  powershell ... -File pv-save-helper.ps1 -Roots "D:\a","D:\b" -Port 8765
#>
[CmdletBinding()]
param(
  [string[]]$Roots = @(),
  [int]$Port = 8765,
  [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
function Say($m){ if(-not $Quiet){ Write-Host ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $m) } }

if(-not $Roots -or $Roots.Count -eq 0){ $Roots = @(Split-Path -Parent $PSScriptRoot) }
$Allow = @()
foreach($r in $Roots){
  try{
    $full = [IO.Path]::GetFullPath($r)
    if(Test-Path -LiteralPath $full){ $Allow += $full.TrimEnd('\') }
  }catch{}
}
if($Allow.Count -eq 0){ throw "no usable root in -Roots" }

function In-Allow($path){
  $p = [IO.Path]::GetFullPath($path)
  foreach($a in $Allow){
    if($p.StartsWith($a + '\', [StringComparison]::OrdinalIgnoreCase)){ return $true }
  }
  return $false
}

$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
try{ $listener.Start() }catch{ throw "port $Port busy: $($_.Exception.Message)" }

Say "保存助手已启动：http://127.0.0.1:$Port"
Say "允许写入的目录："
foreach($a in $Allow){ Say "   $a" }
Say "（关掉本窗口即停止；面板检测不到时会自动退回浏览器弹窗方式）"

function Send-Resp($stream, $code, $json){
  $body = [Text.Encoding]::UTF8.GetBytes([string]$json)
  $head = "HTTP/1.1 $code`r`n" +
          "Content-Type: application/json; charset=utf-8`r`n" +
          "Access-Control-Allow-Origin: *`r`n" +
          "Access-Control-Allow-Methods: GET, POST, OPTIONS`r`n" +
          "Access-Control-Allow-Headers: Content-Type`r`n" +
          "Access-Control-Allow-Private-Network: true`r`n" +
          "Connection: close`r`n" +
          "Content-Length: $($body.Length)`r`n`r`n"
  $hb = [Text.Encoding]::ASCII.GetBytes($head)
  $stream.Write($hb, 0, $hb.Length)
  if($body.Length -gt 0){ $stream.Write($body, 0, $body.Length) }
  $stream.Flush()
}

while($true){
  $client = $null
  try{ $client = $listener.AcceptTcpClient() }catch{ break }
  $stream = $null
  try{
    $client.ReceiveTimeout = 8000
    $stream = $client.GetStream()

    $ms = New-Object IO.MemoryStream
    $buf = New-Object byte[] 8192
    $headerEnd = -1
    while($headerEnd -lt 0){
      $n = $stream.Read($buf, 0, $buf.Length)
      if($n -le 0){ break }
      $ms.Write($buf, 0, $n)
      $arr = $ms.ToArray()
      for($i = 0; $i -le $arr.Length - 4; $i++){
        if($arr[$i] -eq 13 -and $arr[$i+1] -eq 10 -and $arr[$i+2] -eq 13 -and $arr[$i+3] -eq 10){ $headerEnd = $i + 4; break }
      }
      if($ms.Length -gt 262144){ break }
    }
    $allbytes = $ms.ToArray()
    if($headerEnd -lt 0){ $client.Close(); continue }

    $headerText = [Text.Encoding]::ASCII.GetString($allbytes, 0, $headerEnd)
    $lines = $headerText -split "`r`n"
    $parts = $lines[0].Split(' ')
    if($parts.Count -lt 2){ $client.Close(); continue }
    $method = $parts[0]; $url = $parts[1]

    $len = 0
    foreach($l in $lines){
      if($l -match '^(?i)Content-Length:\s*(\d+)'){ $len = [int]$Matches[1] }
    }

    $body = ''
    if($len -gt 0){
      $bb = New-Object byte[] $len
      $have = $allbytes.Length - $headerEnd
      if($have -gt $len){ $have = $len }
      if($have -gt 0){ [Array]::Copy($allbytes, $headerEnd, $bb, 0, $have) }
      while($have -lt $len){
        $n = $stream.Read($bb, $have, $len - $have)
        if($n -le 0){ break }
        $have += $n
      }
      $body = [Text.Encoding]::UTF8.GetString($bb, 0, $have)
    }

    if($method -eq 'OPTIONS'){ Send-Resp $stream '204 No Content' '{}'; $client.Close(); continue }

    if($method -eq 'GET' -and $url -like '/ping*'){
      Send-Resp $stream '200 OK' (@{ ok = $true; roots = $Allow; port = $Port } | ConvertTo-Json -Compress)
      $client.Close(); continue
    }

    if($method -eq 'POST' -and $url -like '/save*'){
      try{ $obj = $body | ConvertFrom-Json }catch{ Send-Resp $stream '400 Bad Request' '{"ok":false,"error":"bad json"}'; $client.Close(); continue }

      $path = [string]$obj.path
      $html = [string]$obj.html
      if(-not $path -or -not $html){ Send-Resp $stream '400 Bad Request' '{"ok":false,"error":"path/html missing"}'; $client.Close(); continue }

      $ext = [IO.Path]::GetExtension($path).ToLower()
      if($ext -ne '.html' -and $ext -ne '.htm'){
        Say "reject (not html): $path"
        Send-Resp $stream '403 Forbidden' '{"ok":false,"error":"only .html/.htm allowed"}'; $client.Close(); continue
      }
      if(-not (In-Allow $path)){
        Say "reject (outside roots): $path"
        Send-Resp $stream '403 Forbidden' '{"ok":false,"error":"outside allowed roots"}'; $client.Close(); continue
      }
      if(-not (Test-Path -LiteralPath $path)){
        Say "reject (not found): $path"
        Send-Resp $stream '404 Not Found' '{"ok":false,"error":"target not found (overwrite only)"}'; $client.Close(); continue
      }

      try{
        $tmp = "$path.pvsave.tmp"
        [IO.File]::WriteAllText($tmp, $html, (New-Object Text.UTF8Encoding($false)))
        Move-Item -LiteralPath $tmp -Destination $path -Force
        Say ("saved {0} ({1:N0} chars)" -f (Split-Path $path -Leaf), $html.Length)
        Send-Resp $stream '200 OK' '{"ok":true}'
      }catch{
        Say "write failed: $($_.Exception.Message)"
        Send-Resp $stream '500 Internal Server Error' (@{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress)
      }
      $client.Close(); continue
    }

    Send-Resp $stream '404 Not Found' '{"ok":false,"error":"not found"}'
    $client.Close()
  }catch{
    try{ if($stream){ $stream.Close() } }catch{}
    try{ if($client){ $client.Close() } }catch{}
  }
}
$listener.Stop()
