param([switch]$CheckOnly, [switch]$CheckBootstrap, [switch]$MirrorOnly)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$OutputEncoding = [Text.UTF8Encoding]::new($false)
$repo = 'windroye590-create/fpv-updates'
$claspVersion = '3.4.1'
$archiveCacheBase = 'https://raw.githubusercontent.com/windroye590-create/litakova-updates/6ed911b3cf28bf3f7401e0b80c79b8713d7ff61f/release-tools/vendor/'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

function Assert-NativeSuccess([string]$Operation) {
    if ($LASTEXITCODE -ne 0) { throw "$Operation failed (exit $LASTEXITCODE)." }
}

function Get-PortableDefinition([string]$Command) {
    $architecture = $env:PROCESSOR_ARCHITEW6432
    if (-not $architecture) { $architecture = $env:PROCESSOR_ARCHITECTURE }
    $arm = $architecture -eq 'ARM64'
    if (-not $arm -and $architecture -ne 'AMD64') { throw 'This setup supports Windows x64 and ARM64.' }
    if ($Command -eq 'gh') {
        $arch = 'amd64'
        $hash = '98d0cfa794721665d7973dd728c78aff7bd836d58f10f6d7a03568eccb0a22e0'
        $asset = '679195750'
        if ($arm) { $arch = 'arm64'; $hash = '197211c98687d7770ac331fe8a3b6c198c389108c1536cdbedf659fe4703e484'; $asset = '679195799' }
        $mirror = $null
        if (-not $arm) { $mirror = $archiveCacheBase + 'gh_2.103.3_windows_amd64.zip' }
        return @{ Version = '2.103.3'; Arch = $arch; Exe = 'gh.exe'; SHA256 = $hash; MirrorUrl = $mirror; Url = "https://api.github.com/repos/cli/cli/releases/assets/$asset"; FallbackUrl = "https://github.com/cli/cli/releases/download/v2.103.3/gh_2.103.3_windows_$arch.zip" }
    }
    if ($Command -eq 'node') {
        $arch = 'x64'
        $hash = 'dcc60d59a0746999f99064a01c020445d54d84228c691cdbf25b49ac3b59150a'
        if ($arm) { $arch = 'arm64'; $hash = 'a9427139595156ef484e1fb08957676e09d4232368dd1743a2a9f93f3d241b14' }
        $mirror = $null
        if (-not $arm) { $mirror = $archiveCacheBase + 'node-v26.13.0-win-x64.zip' }
        return @{ Version = '26.13.0'; Arch = $arch; Exe = 'node.exe'; SHA256 = $hash; MirrorUrl = $mirror; Url = "https://nodejs.org/dist/v26.13.0/node-v26.13.0-win-$arch.zip" }
    }
    throw "Unknown setup tool: $Command"
}

function Install-PortableTool([string]$Command, [string]$ToolsRoot) {
    $definition = Get-PortableDefinition $Command
    $install = Join-Path $ToolsRoot "$Command-$($definition.Version)-$($definition.Arch)"
    $marker = Join-Path $install '.verified-sha256'
    if (-not (Test-Path -LiteralPath $marker) -or (Get-Content -Raw -LiteralPath $marker).Trim() -ne $definition.SHA256) {
        $stage = Join-Path ([IO.Path]::GetTempPath()) ('fpv-tool-' + [Guid]::NewGuid().ToString('N'))
        [void](New-Item -ItemType Directory -Path $stage -Force)
        try {
            $download = Join-Path $stage 'package.zip'
            Write-Host "Downloading official $Command $($definition.Version)..."
            $verified = $false
            $urls = @()
            if ($definition.MirrorUrl) { $urls += $definition.MirrorUrl }
            if (-not $MirrorOnly) {
                $urls += $definition.Url
                if ($definition.FallbackUrl) { $urls += $definition.FallbackUrl }
            }
            if ($urls.Count -eq 0) { throw 'The raw archive cache currently supports Windows x64 only.' }
            foreach ($url in $urls) {
                try {
                    $headers = @{ Accept = 'application/octet-stream' }
                    if ($url.StartsWith('https://api.github.com/')) { $headers['X-GitHub-Api-Version'] = '2022-11-28' }
                    Invoke-WebRequest -UseBasicParsing -Uri $url -Headers $headers -UserAgent 'FPV-release-setup' -OutFile $download -TimeoutSec 90
                    if ((Get-FileHash -LiteralPath $download -Algorithm SHA256).Hash -ne $definition.SHA256) {
                        throw "The downloaded $Command archive failed SHA-256 verification."
                    }
                    $verified = $true
                    break
                } catch {
                    Write-Host "Download attempt for $Command failed: $($_.Exception.Message)"
                }
            }
            if (-not $verified) { throw "Could not download the verified official $Command archive. Run setup again to retry." }
            $expanded = Join-Path $stage 'expanded'
            Expand-Archive -LiteralPath $download -DestinationPath $expanded
            $executables = @(Get-ChildItem -LiteralPath $expanded -Recurse -File -Filter $definition.Exe)
            if ($executables.Count -ne 1) { throw "Unexpected official $Command archive layout." }
            [void](New-Item -ItemType Directory -Path $ToolsRoot -Force)
            if (Test-Path -LiteralPath $install) { Remove-Item -LiteralPath $install -Recurse -Force }
            Move-Item -LiteralPath $expanded -Destination $install
            [IO.File]::WriteAllText($marker, $definition.SHA256)
        } finally {
            if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
        }
    }
    $executables = @(Get-ChildItem -LiteralPath $install -Recurse -File -Filter $definition.Exe)
    if ($executables.Count -ne 1) { throw "Portable $Command is incomplete; remove $install and retry." }
    $env:Path = $executables[0].DirectoryName + [IO.Path]::PathSeparator + $env:Path
    return $executables[0].FullName
}

function Ensure-Tool([string]$Command) {
    $found = Get-Command $Command -ErrorAction SilentlyContinue
    $usable = $null -ne $found
    if ($usable -and $Command -eq 'node') {
        $major = [int]((& node --version).TrimStart('v').Split('.')[0])
        $usable = $major -ge 22 -and $null -ne (Get-Command npx.cmd -ErrorAction SilentlyContinue)
    }
    if (-not $usable) {
        $toolsRoot = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'FPVReleaseTools'
        [void](Install-PortableTool $Command $toolsRoot)
    }
}

function Test-GitHubLogin {
    $previousPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        & gh auth status --hostname github.com 1>$null 2>$null
        return $LASTEXITCODE -eq 0
    } finally {
        $ErrorActionPreference = $previousPreference
    }
}

function Invoke-SetupProcess([string]$Executable, [string]$Arguments) {
    # A closed stdin keeps gh's browser authorization separate from Git setup.
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $Executable
    $info.Arguments = $Arguments
    $info.UseShellExecute = $false
    $info.RedirectStandardInput = $true
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $info
    try {
        [void]$process.Start()
        $process.StandardInput.Close()
        $process.WaitForExit()
        return $process.ExitCode
    } finally { $process.Dispose() }
}

function Test-SetupProcessWithoutGit {
    $powershellPath = Join-Path ([Environment]::GetFolderPath('System')) 'WindowsPowerShell\v1.0\powershell.exe'
    $savedPath = $env:Path
    try {
        $env:Path = ''
        $arguments = '-NoProfile -NonInteractive -Command "if (Get-Command git -ErrorAction SilentlyContinue) { exit 93 }; if (-not [Console]::IsInputRedirected) { exit 91 }; if ([Console]::In.ReadToEnd().Length -ne 0) { exit 92 }; exit 0"'
        if ((Invoke-SetupProcess $powershellPath $arguments) -ne 0) { throw 'Browser login process must work without Git and with closed stdin.' }
        if ((Invoke-SetupProcess $powershellPath '-NoProfile -NonInteractive -Command "exit 23"') -ne 23) { throw 'Setup must retain child process error status.' }
    } finally { $env:Path = $savedPath }
}

function Test-PortableBootstrap {
    $testRoot = Join-Path ([IO.Path]::GetTempPath()) ('fpv-bootstrap-test-' + [Guid]::NewGuid().ToString('N'))
    try {
        foreach ($command in @('gh', 'node')) {
            $executable = Install-PortableTool $command $testRoot
            & $executable --version
            Assert-NativeSuccess "Running portable $command"
        }
        & npx.cmd --version
        Assert-NativeSuccess 'Running portable npm/npx'
        $signedIn = Test-GitHubLogin
        if ($signedIn -isnot [bool]) { throw 'GitHub login detection failed.' }
        Write-Host 'Portable GitHub CLI and Node.js verified without winget or administrator access.'
    } finally {
        if (Test-Path -LiteralPath $testRoot) { Remove-Item -LiteralPath $testRoot -Recurse -Force }
    }
}

$expectedOwner = 'fpv.training.center@gmail.com'

function Select-GoogleCredential($Stored) {
    if (-not $Stored.PSObject.Properties['tokens']) { throw 'Unexpected clasp credential format.' }
    $selected = $Stored.tokens.PSObject.Properties['fpv-release']
    if ($null -eq $selected) { throw 'The FPV Google login was not saved.' }
    foreach ($name in @('client_id','client_secret','refresh_token')) {
        if (-not $selected.Value.$name) { throw "FPV authorization is missing $name." }
    }
    return @{ type='authorized_user'; client_id=$selected.Value.client_id; client_secret=$selected.Value.client_secret; refresh_token=$selected.Value.refresh_token } | ConvertTo-Json -Compress
}

function Read-FPVSigning([string]$Folder, [Security.SecureString]$NewPassword = $null) {
    Add-Type -AssemblyName System.Security
    [void](New-Item -ItemType Directory -Path $Folder -Force)
    $acl = Get-Acl -LiteralPath $Folder
    $acl.SetAccessRuleProtection($true,$false)
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $rule = [Security.AccessControl.FileSystemAccessRule]::new($identity,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
    $acl.AddAccessRule($rule)
    Set-Acl -LiteralPath $Folder -AclObject $acl
    $keyPath = Join-Path $Folder 'fpv-release.p12'
    $passwordPath = Join-Path $Folder 'signing-password.dpapi'
    if ((Test-Path -LiteralPath $keyPath) -ne (Test-Path -LiteralPath $passwordPath)) { throw 'The local FPV key backup is incomplete. Restore both files before continuing.' }
    if (-not (Test-Path -LiteralPath $keyPath)) {
        if ($null -eq $NewPassword) { $NewPassword = Read-Host 'Choose a private FPV signing backup password (16+ characters; keep it with your backup)' -AsSecureString }
        $password = [Net.NetworkCredential]::new('',$NewPassword).Password
        if ($password.Length -lt 16) { throw 'Use at least 16 characters for the FPV signing backup password.' }
        $rsa = [Security.Cryptography.RSACng]::new(3072)
        try {
            $request = [Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=FPV Commission Updates',$rsa,[Security.Cryptography.HashAlgorithmName]::SHA256,[Security.Cryptography.RSASignaturePadding]::Pkcs1)
            $certificate = $request.CreateSelfSigned([DateTimeOffset]::UtcNow.AddDays(-1),[DateTimeOffset]::UtcNow.AddYears(20))
            try { $bytes = $certificate.Export([Security.Cryptography.X509Certificates.X509ContentType]::Pkcs12,$password) } finally { $certificate.Dispose() }
        } finally { $rsa.Dispose() }
        $protected = [Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($password),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
        [IO.File]::WriteAllBytes($passwordPath,$protected)
        [IO.File]::WriteAllBytes($keyPath,$bytes)
    }
    $password = [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($passwordPath),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))
    $bytes = [IO.File]::ReadAllBytes($keyPath)
    $flags = [Security.Cryptography.X509Certificates.X509KeyStorageFlags]::Exportable -bor [Security.Cryptography.X509Certificates.X509KeyStorageFlags]::EphemeralKeySet
    $certificate = [Security.Cryptography.X509Certificates.X509Certificate2]::new($bytes,$password,$flags)
    try {
        $private = [Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPrivateKey($certificate)
        try { if ($private.KeySize -ne 3072) { throw 'FPV requires the original RSA-3072 key.' } } finally { $private.Dispose() }
        $sha = [Security.Cryptography.SHA256]::Create()
        try { $fingerprint = [BitConverter]::ToString($sha.ComputeHash($certificate.RawData)).Replace('-','').ToLowerInvariant() } finally { $sha.Dispose() }
    } finally { $certificate.Dispose() }
    return @{ Key=[Convert]::ToBase64String($bytes); Password=$password; Fingerprint=$fingerprint; Path=$keyPath }
}

function Set-ActionSecret([string]$Name,[string]$Value) {
    $Value | & gh secret set $Name --repo $repo
    Assert-NativeSuccess "Saving secret $Name"
}

if ($CheckOnly) {
    Test-SetupProcessWithoutGit
    $fixture = '{"tokens":{"fpv-release":{"client_id":"id","client_secret":"secret","refresh_token":"refresh"},"other":{"refresh_token":"must-not-be-uploaded"}}}' | ConvertFrom-Json
    $selected = Select-GoogleCredential $fixture
    if ($selected.Contains('must-not-be-uploaded') -or -not $selected.Contains('refresh_token')) { throw 'FPV credential isolation failed.' }
    $scratch = Join-Path ([IO.Path]::GetTempPath()) ('fpv-key-test-' + [Guid]::NewGuid().ToString('N'))
    try {
        $a = Read-FPVSigning $scratch (ConvertTo-SecureString 'test-only-fpv-key-password' -AsPlainText -Force)
        $b = Read-FPVSigning $scratch
        if ($a.Key -ne $b.Key -or $a.Fingerprint -ne $b.Fingerprint -or $a.Fingerprint.Length -ne 64) { throw 'FPV key retry changed its identity.' }
        if (([Text.Encoding]::UTF8.GetString([IO.File]::ReadAllBytes((Join-Path $scratch 'signing-password.dpapi')))).Contains($a.Password)) { throw 'The cached key password must be DPAPI protected.' }
    } finally { if (Test-Path -LiteralPath $scratch) { Remove-Item -LiteralPath $scratch -Recurse -Force } }
    if ($CheckBootstrap) { Test-PortableBootstrap }
    Write-Host 'FPV setup verified: isolated Google credential, original RSA key reuse and DPAPI-protected password.'
    exit 0
}

Write-Host 'FPV Commission owner setup. Sign in to Google as fpv.training.center@gmail.com.'
Ensure-Tool 'gh'
Ensure-Tool 'node'
if (-not (Test-GitHubLogin)) {
    $loginExit = Invoke-SetupProcess (Get-Command gh).Source 'auth login --hostname github.com --git-protocol https --web --skip-ssh-key --scopes repo,workflow'
    if ($loginExit -ne 0 -and -not (Test-GitHubLogin)) { throw 'GitHub sign-in failed.' }
}
& gh api "repos/$repo/actions/secrets/public-key" 1>$null
Assert-NativeSuccess 'Checking access to FPV repository secrets'
$configResponse = & gh api "repos/$repo/contents/commission.json" --jq .content
Assert-NativeSuccess 'Reading the FPV identity'
$config = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String(($configResponse -join ''))) | ConvertFrom-Json
if ($config.id -ne 'fpv' -or $config.ownerEmail -ne $expectedOwner) { throw 'Unexpected FPV owner configuration.' }
$toolsRoot = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'FPVReleaseTools'
$signingFolder = Join-Path $toolsRoot 'signing'
if ($config.signing.certificateSha256 -and -not (Test-Path -LiteralPath (Join-Path $signingFolder 'fpv-release.p12'))) { throw 'FPV already has a signing certificate. Restore its original private backup before continuing.' }
$signing = Read-FPVSigning $signingFolder
if ($config.signing.certificateSha256 -and $config.signing.certificateSha256 -ne $signing.Fingerprint) { throw 'The local key does not match the existing FPV release certificate.' }

Start-Process 'https://script.google.com/home/usersettings?authuser=fpv.training.center%40gmail.com'
[void](Read-Host 'Enable Google Apps Script API for the FPV owner, then press Enter')
& npx.cmd --yes --package "@google/clasp@$claspVersion" clasp login --user fpv-release
Assert-NativeSuccess 'Authorizing the FPV Google owner'
$credentialPath = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.clasprc.json'
$google = Select-GoogleCredential (Get-Content -Raw -LiteralPath $credentialPath | ConvertFrom-Json)
$oauth = $google | ConvertFrom-Json
$token = Invoke-RestMethod -Method Post -Uri 'https://oauth2.googleapis.com/token' -Body @{ client_id=$oauth.client_id;client_secret=$oauth.client_secret;refresh_token=$oauth.refresh_token;grant_type='refresh_token' }
$identity = Invoke-RestMethod -Uri 'https://www.googleapis.com/oauth2/v2/userinfo' -Headers @{ Authorization=('Bearer '+$token.access_token) }
if ($identity.email -ne $expectedOwner -or $identity.verified_email -ne $true) { throw 'Wrong Google account. Run setup again and choose fpv.training.center@gmail.com.' }
$token = $null
$oauth = $null
Set-ActionSecret 'GAS_CREDENTIALS' $google
Set-ActionSecret 'LK_SIGNING_PKCS12_BASE64' $signing.Key
Set-ActionSecret 'LK_SIGNING_PASSWORD' $signing.Password
$google = $null
$signing = $null

$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
$random = New-Object byte[] 16
try { $rng.GetBytes($random) } finally { $rng.Dispose() }
$invite = [BitConverter]::ToString($random).Replace('-','')
$protected = [Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($invite),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
[IO.File]::WriteAllBytes((Join-Path $toolsRoot 'owner-invite.dpapi'),$protected)
$sha = [Security.Cryptography.SHA256]::Create()
try { $inviteHash = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($invite))).Replace('-','').ToLowerInvariant() } finally { $sha.Dispose() }
$inviteUntil = [DateTimeOffset]::UtcNow.AddHours(24).ToUnixTimeMilliseconds()
& gh workflow run bootstrap-fpv.yml --repo $repo --ref main -f "invite_hash=$inviteHash" -f "invite_until=$inviteUntil"
Assert-NativeSuccess 'Starting FPV provisioning'
Write-Host ''
Write-Host 'First instructor registration after the EXE is published:'
Write-Host '  Name: Rozrobnyk (use Ukrainian spelling in the application)'
Write-Host '  Login: WindRoy'
Write-Host "  Private owner code (valid 24 hours; enter in the FPV app): $invite"
Write-Host "Keep the original private signing backup: $signingFolder"
Write-Host "Provisioning result: https://github.com/$repo/actions/workflows/bootstrap-fpv.yml"
Write-Host 'The workflow will show the Google editor link. Run setupCommission once there to grant Spreadsheet access.'
Write-Host 'After Google authorization, release 1.0.0 using release.yml.'
