$action = New-ScheduledTaskAction -Execute "node" -Argument "-e `"require('./memory-service/gate').runMaintenance()`"" -WorkingDirectory "e:\better\EmotionalAgent"
$trigger = New-ScheduledTaskTrigger -Daily -At 04:00
Register-ScheduledTask -TaskName "shen-yuchu-maintenance" -Action $action -Trigger $trigger -RunLevel Limited -Force
Write-Output "done"
