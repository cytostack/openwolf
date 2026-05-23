' OpenWolf hook-runner.vbs
'
' Hides the brief Windows console flash that appears when Claude Code
' spawns one of the .wolf/hooks/*.js scripts via `node` (the node.exe
' binary is a console-subsystem application, so even when invoked with
' CREATE_NO_WINDOW it can flash a window on slower or DPI-scaled
' Windows setups when launched as a child of another console process).
'
' Wraps the underlying command in WScript.Shell.Run(cmd, 0, True):
'   0     — SW_HIDE: never show a window
'   True  — wait for completion and propagate the exit code
'
' Usage from a Claude Code hooks entry:
'   wscript //nologo "<install>/dist/assets/hook-runner.vbs" node "<script>"
'
' The wrapper re-quotes every argument so paths with spaces survive
' the round-trip through WScript.Arguments → cmd string → CreateProcess.

If WScript.Arguments.Count < 1 Then
  WScript.Quit(1)
End If

Dim cmd, i
cmd = ""
For i = 0 To WScript.Arguments.Count - 1
  If i > 0 Then cmd = cmd & " "
  cmd = cmd & """" & WScript.Arguments(i) & """"
Next

Dim sh
Set sh = CreateObject("WScript.Shell")
WScript.Quit(sh.Run(cmd, 0, True))
