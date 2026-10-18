param(
  [string]$OutputRoot = 'C:\Users\MSI\Desktop\gym-staging-backups'
)

$ErrorActionPreference = 'Stop'
$project = 'alasas-fit-staging'
$database = 'alasas-fit-staging-default-rtdb'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$target = Join-Path $OutputRoot $stamp
New-Item -ItemType Directory -Path $target -Force | Out-Null

# firebase-tools --json emits the RTDB value followed by a separate status JSON
# object. Capture stdout as text, extract exactly the first JSON value, and
# reject anything that is not a complete object before writing the backup.
$raw = (& npx -y firebase-tools@latest database:get / --project $project --json 2>&1 | Out-String)
$statusStart = $raw.IndexOf("`n{`r`n  `"status`"")
if ($statusStart -lt 0) { $statusStart = $raw.IndexOf("`n{`n  `"status`"") }
if ($statusStart -lt 0) {
  throw 'Firebase CLI output did not match the expected data-plus-status format; backup was not written.'
}
$json = $raw.Substring(0, $statusStart).Trim()
$data = $json | ConvertFrom-Json
if ($null -eq $data) { throw 'Decoded RTDB backup is null.' }

function Get-NodeCount($node) {
  if ($null -eq $node) { return 0 }
  if ($node -is [System.Array]) { return @($node).Count }
  if ($node -is [System.Management.Automation.PSCustomObject]) { return @($node.psobject.Properties).Count }
  return 1
}

$backupPath = Join-Path $target 'rtdb.json'
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText($backupPath, $json, $utf8NoBom)
$sha = (Get-FileHash -Algorithm SHA256 -LiteralPath $backupPath).Hash
$manifest = [ordered]@{
  project = $project
  rtdb = $database
  createdAt = (Get-Date).ToUniversalTime().ToString('o')
  backup = 'rtdb.json'
  sha256 = $sha
  rootKeys = @($data.psobject.Properties.Name)
  memberCount = Get-NodeCount $data.appData.members
  keyedMemberCount = Get-NodeCount $data.appData.membersById
  tombstoneCount = Get-NodeCount $data.appData.deletedMemberIds
  courseCount = Get-NodeCount $data.appData.courses
}
$manifestJson = $manifest | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText((Join-Path $target 'backup-manifest.json'), $manifestJson, $utf8NoBom)
Write-Output (ConvertTo-Json $manifest -Compress)
