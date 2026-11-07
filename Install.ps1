param(
    [Parameter(Mandatory)]
    [ValidatePattern('^[a-p]{32}$')]
    [string]$ExtensionId,

    [string]$Python = 'python'
)

$ErrorActionPreference = 'Stop'
$hostName = 'com.youval1234.brave_yubikey_fill'
$root = Join-Path $env:LOCALAPPDATA 'BraveYubiKeyFill'
# Brave on Windows looks up Native Messaging hosts in Chromium's Chrome-compatible registry location.
$registry = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$hostName"
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'

& $Python -I -c "import sys, platform, tkinter; assert sys.version_info[:2] == (3, 14) and platform.machine() == 'AMD64'"
if ($LASTEXITCODE -ne 0) { throw 'Python 3.14 x64 with Tk is required.' }
if (!(Test-Path -LiteralPath $csc -PathType Leaf)) { throw 'The Windows .NET Framework compiler is required.' }

$build = Join-Path $root ('install-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $build -Force | Out-Null
& $Python -I -m venv (Join-Path $build 'venv')
if ($LASTEXITCODE -ne 0) { throw 'Could not create the private Python environment.' }
$runtime = Join-Path $build 'venv\Scripts\python.exe'
& $runtime -I -m pip --isolated install --disable-pip-version-check --require-hashes --only-binary=:all: --index-url https://pypi.org/simple -r (Join-Path $PSScriptRoot 'host\requirements.txt')
if ($LASTEXITCODE -ne 0) { throw 'Could not install the pinned Yubico SDK.' }

$exe = Join-Path $build 'YubiKeyFill.exe'
& $csc /nologo /target:winexe /platform:x64 /optimize+ "/out:$exe" (Join-Path $PSScriptRoot 'host\Launcher.cs')
if ($LASTEXITCODE -ne 0) { throw 'Could not compile the native launcher.' }
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'host\yubikey_fill_host.py') -Destination $build
# Optional private-release checks use the existing GitHub CLI installation.
# Store only its resolved path, never its authentication material.
$githubCli = Get-Command gh -CommandType Application -ErrorAction SilentlyContinue
if ($githubCli) {
    $cliJson = @{ path = $githubCli.Source } | ConvertTo-Json
    [IO.File]::WriteAllText((Join-Path $build 'github-cli.local.json'), $cliJson, [Text.UTF8Encoding]::new($false))
}
$origin = "chrome-extension://$ExtensionId/"
Set-Content -LiteralPath (Join-Path $build 'origin.txt') -Value $origin -Encoding ascii -NoNewline
$manifest = Join-Path $build 'native-host.json'
$json = @{
    name = $hostName
    description = 'YubiKey Fill local helper'
    path = $exe
    type = 'stdio'
    allowed_origins = @($origin)
} | ConvertTo-Json
[IO.File]::WriteAllText($manifest, $json, [Text.UTF8Encoding]::new($false))

# Switch Brave to this installation only after every build step succeeds.
New-Item -Path $registry -Force | Out-Null
Set-Item -LiteralPath $registry -Value $manifest
Write-Host "Registered the local helper for Brave extension $ExtensionId."
