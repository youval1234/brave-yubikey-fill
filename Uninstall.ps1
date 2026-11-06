$ErrorActionPreference = 'Stop'
$registry = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.youval1234.brave_yubikey_fill'
if (Test-Path -LiteralPath $registry) {
    Remove-Item -LiteralPath $registry
}
Write-Host 'Helper unregistered. Remove YubiKey Fill from brave://extensions to remove its site approvals.'
Write-Host ('To remove the local helper files, delete ' + (Join-Path $env:LOCALAPPDATA 'BraveYubiKeyFill') + '.')
