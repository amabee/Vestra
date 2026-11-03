param(
    [Parameter(Mandatory = $true)][string]$InstallerPath,
    [Parameter(Mandatory = $true)][string]$AppPath,
    [Parameter(Mandatory = $true)][string]$ExpectedPublisherName
)
$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($ExpectedPublisherName)) { throw 'A trusted Windows publisher name is required.' }
foreach ($target in @($InstallerPath, $AppPath)) {
    $signature = Get-AuthenticodeSignature -LiteralPath $target
    if ($signature.Status -ne 'Valid') { throw "Release signature is not valid: $target ($($signature.Status))" }
    $publisher = $signature.SignerCertificate.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false)
    if ($publisher -cne $ExpectedPublisherName) { throw "Release publisher does not match the configured identity: $target" }
    Write-Output "Verified publisher signature: $target"
}
