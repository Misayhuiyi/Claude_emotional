$taskName = 'shen-yuchu-session-watcher'
$action = New-ScheduledTaskAction -Execute 'node' -Argument 'e:\better\EmotionalAgent\memory-service\session-watcher.js' -WorkingDirectory 'e:\better\EmotionalAgent'
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -RunLevel Limited -Force
Write-Output "session-watcher 开机自启已设置"
