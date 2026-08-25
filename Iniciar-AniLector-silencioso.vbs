' ==== AniLector - arranque silencioso (sin ventana) ====
' Úsalo para dejar el servidor corriendo en segundo plano, por ejemplo
' poniéndolo en la carpeta de Inicio de Windows (tecla Win+R -> shell:startup).
' Así el servidor de TV queda siempre disponible sin abrir una consola.
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
' Carpeta donde está este archivo
carpeta = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = carpeta
' 0 = ventana oculta ; False = no esperar
sh.Run "node server.mjs", 0, False
