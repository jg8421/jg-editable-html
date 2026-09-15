<#
install-autostart.ps1 —— 把保存助手注册成"登录时自动启动"（幂等、可卸载）

· 任务名固定为 pv-save-helper，重复运行会覆盖旧的（不会重复注册）
· 当前用户身份、普通权限、隐藏窗口；登录后静默在后台监听 127.0.0.1:8765
· 卸载：运行 卸载开机自启.cmd（或 install-autostart.ps1 -Remove）
#>
[CmdletBinding()]
param([switch]$Remove)

$ErrorActionPreference = 'Stop'
$TaskName = 'pv-save-helper'
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Helper = Join-Path $Here 'pv-save-helper.ps1'
$Roots = Split-Path -Parent $Here

if($Remove){
  try{
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction Stop
    "已卸载开机自启（任务 $TaskName 已删除）"
  }catch{
    "没有找到任务 $TaskName（可能本来就没装）"
  }
  return
}

if(-not (Test-Path -LiteralPath $Helper)){ throw "找不到 pv-save-helper.ps1" }

$argLine = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}" -Roots "{1}" -Quiet' -f $Helper, $Roots

$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $argLine
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -Hidden
$principal = New-ScheduledTaskPrincipal -UserId ("{0}\{1}" -f $env:USERDOMAIN, $env:USERNAME) -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description "HTML 面板 Ctrl+S 零弹窗保存助手" -Force | Out-Null

"已注册开机自启：任务名 $TaskName"
"  脚本    ：$Helper"
"  允许写入：$Roots"
"  登录后会自动在后台运行（无窗口）；面板 Ctrl+S 即刻零弹窗。"
"  想取消  ：双击「卸载开机自启.cmd」"
