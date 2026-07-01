$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c e:\better\EmotionalAgent\scripts\daily-summary.cmd" -WorkingDirectory "e:\better\EmotionalAgent"
$trigger = New-ScheduledTaskTrigger -Daily -At 03:00
Register-ScheduledTask -TaskName "shen-yuchu-summary" -Action $action -Trigger $trigger -RunLevel Limited -Force
Write-Output "每日摘要定时任务已创建（凌晨3点）"
