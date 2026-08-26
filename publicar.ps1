# =============================================================
#  AniLector - publicar una version nueva
#  -------------------------------------------------------------
#  Uso:   .\publicar.ps1 "v4.0: lo que trae esta version"
#
#  Hace, en orden:
#    1. Se asegura de que VERSION en sw.js sea distinta de la ya
#       publicada  <-- el paso que no se puede olvidar: sin el, los
#       navegadores siguen sirviendo la copia guardada y los
#       cambios NO se ven nunca.
#    2. git add -A
#    3. git commit
#    4. git pull --rebase   (por si se toco algo desde otro equipo)
#    5. git push
#
#  Si algo falla, se para ahi mismo y lo dice: nunca deja el repo
#  a medias sin avisar.
# =============================================================

param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$Mensaje
)

# A proposito NO se usa "Stop": git escribe avisos normales por la
# salida de errores (el pull, por ejemplo) y con "Stop" el script se
# cortaria sin motivo. El control se hace mirando $LASTEXITCODE
# despues de cada comando, que es lo fiable.
$ErrorActionPreference = "Continue"
Set-Location -LiteralPath $PSScriptRoot

function Paso($n, $texto) { Write-Host "`n[$n/5] $texto" -ForegroundColor Cyan }
function Bien($texto)     { Write-Host "      OK  $texto" -ForegroundColor Green }
function Mal($texto)      { Write-Host "`n      ERROR: $texto`n" -ForegroundColor Red; exit 1 }

function VersionDe($texto) {
  $m = [regex]::Match($texto, 'const VERSION = "(v\d+\.\d+\.\d+)"')
  if ($m.Success) { return $m.Groups[1].Value }
  return $null
}

# --- 0. comprobaciones ---------------------------------------
if (-not (Test-Path "sw.js")) { Mal "No encuentro sw.js. Ejecuta el script desde la carpeta del repositorio." }
if (-not (Test-Path ".git"))  { Mal "Esta carpeta no es un repositorio git." }

if (-not (git status --porcelain)) {
  Write-Host "`nNo hay nada que publicar: el repositorio esta limpio.`n" -ForegroundColor Yellow
  exit 0
}

# --- 1. la version del service worker ------------------------
Paso 1 "Comprobando la version del service worker"

$sw = Get-Content -LiteralPath "sw.js" -Raw -Encoding UTF8
$actual = VersionDe $sw
if (-not $actual) { Mal "No encuentro 'const VERSION = ""vX.Y.Z"";' en sw.js." }

# La que esta REALMENTE publicada es la del ultimo commit, no la del
# archivo: si el archivo ya se edito a mano, subirla otra vez seria
# saltarse un numero sin necesidad.
$publicada = $null
git cat-file -e "HEAD:sw.js" 2>$null
if ($LASTEXITCODE -eq 0) { $publicada = VersionDe (git show "HEAD:sw.js" | Out-String) }

if ($null -eq $publicada) {
  $nueva = $actual
  Bien "$actual (sw.js aun no estaba publicado; se publica tal cual)"
}
elseif ($publicada -ne $actual) {
  $nueva = $actual
  Bien "$publicada -> $actual (ya la habias subido a mano)"
}
else {
  # Hay que subirla. Si el mensaje empieza por "vX.Y" se usa ese
  # numero, para que la version del commit y la del service worker
  # no se separen nunca.
  $p = [regex]::Match($actual, '^v(\d+)\.(\d+)\.(\d+)$')
  $mayor = [int]$p.Groups[1].Value
  $menor = [int]$p.Groups[2].Value
  $parche = [int]$p.Groups[3].Value

  $mv = [regex]::Match($Mensaje, '^v(\d+)\.(\d+)')
  if ($mv.Success -and ([int]$mv.Groups[1].Value -gt $mayor -or
      ([int]$mv.Groups[1].Value -eq $mayor -and [int]$mv.Groups[2].Value -gt $menor))) {
    $nueva = "v$([int]$mv.Groups[1].Value).$([int]$mv.Groups[2].Value).0"
  } else {
    $nueva = "v$mayor.$menor.$($parche + 1)"
  }

  $sw = $sw -replace 'const VERSION = "v\d+\.\d+\.\d+"', "const VERSION = ""$nueva"""
  try {
    # Sin BOM: GitHub Pages sirve el sw.js tal cual y un BOM lo rompe.
    [System.IO.File]::WriteAllText((Join-Path $PWD "sw.js"), $sw, (New-Object System.Text.UTF8Encoding($false)))
  } catch { Mal "No pude escribir sw.js: $_" }
  Bien "$actual -> $nueva  (actualizado en sw.js)"
}

if ($nueva -eq $publicada) { Mal "La version seguiria siendo $nueva. Cambiala en sw.js o los navegadores no veran los cambios." }

# --- 2 y 3. add + commit -------------------------------------
Paso 2 "Anadiendo los cambios"
git add -A
if ($LASTEXITCODE -ne 0) { Mal "git add fallo." }
Bien "listo"

Paso 3 "Creando el commit"
git commit -m $Mensaje
if ($LASTEXITCODE -ne 0) { Mal "git commit fallo. Revisa el mensaje de arriba." }
Bien $Mensaje

# --- 4. pull --------------------------------------------------
Paso 4 "Trayendo lo que haya en GitHub (pull --rebase)"
git pull --rebase
if ($LASTEXITCODE -ne 0) {
  Mal "El pull encontro un conflicto. Resuelvelo y despues: git rebase --continue  y  git push"
}
Bien "sin conflictos"

# --- 5. push --------------------------------------------------
Paso 5 "Publicando en GitHub (push)"
git push
if ($LASTEXITCODE -ne 0) { Mal "git push fallo. Revisa el mensaje de arriba." }
Bien "publicado"

Write-Host "`n=============================================" -ForegroundColor Green
Write-Host "  Publicado $nueva" -ForegroundColor Green
Write-Host "=============================================" -ForegroundColor Green
Write-Host "  GitHub Pages tarda 1-2 minutos en actualizar."
Write-Host "  La primera vez, abre la app y recarga forzado"
Write-Host "  (Ctrl+F5). A partir de ahi el service worker se"
Write-Host "  encarga solo.`n"
