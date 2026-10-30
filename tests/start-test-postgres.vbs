Set fso = CreateObject("Scripting.FileSystemObject")
cmdPath = fso.BuildPath(fso.GetParentFolderName(WScript.ScriptFullName), "start-test-postgres.cmd")
CreateObject("WScript.Shell").Run "cmd /c """ & cmdPath & """", 0, False
