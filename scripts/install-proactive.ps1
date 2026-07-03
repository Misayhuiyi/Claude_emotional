$taskName = 'shen-yuchu-proactive'
$projectDir = 'e:\better\EmotionalAgent'
$action = New-ScheduledTaskAction -Execute 'node' -Argument "$projectDir\memory-service\proactive-main.js" -WorkingDirectory $projectDir
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -RunLevel Limited -Force
Write-Output "proactive-service 开机自启已设置"
