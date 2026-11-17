# RepostRx password test (no password, wrong password, demo password, owner password).
# SAFE: it can't create or change a post.
# - POST requests send an empty body {}, which every function rejects (400) before
#   calling Blotato or Claude, even if the password check were broken.
# - GET requests use made-up IDs, so even a broken check could only read nothing.
#   (Demo's import-status call does reach Blotato, read-only, for the made-up ID.)
# - The owner password is only sent to whoami (calls nothing) and archive (read-only,
#   no Blotato call).
# Passwords are read with Read-Host -AsSecureString: not shown, not saved, not in history.
#
# Run from the repostrx folder:
#   powershell -ExecutionPolicy Bypass -File scripts\test-auth.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\test-auth.ps1 -Base https://repostrx-renee.netlify.app

param([string]$Base = "http://localhost:8888")

function Read-Secret($prompt) {
  $secure = Read-Host -AsSecureString $prompt
  return (New-Object System.Net.NetworkCredential("", $secure)).Password
}

$fakeId = "1a2b3c4d-1234-4abc-8def-0123456789ab"   # made-up example, not a real post
$endpoints = @(
  @{ Name = "accounts";      Method = "GET";  Path = "/.netlify/functions/accounts" },
  @{ Name = "import";        Method = "POST"; Path = "/.netlify/functions/import" },
  @{ Name = "import-status"; Method = "GET";  Path = "/.netlify/functions/import-status?id=$fakeId" },
  @{ Name = "drafts";        Method = "POST"; Path = "/api/drafts" },
  @{ Name = "schedule";      Method = "POST"; Path = "/.netlify/functions/schedule" },
  @{ Name = "post-status";   Method = "GET";  Path = "/.netlify/functions/post-status?id=$fakeId" },
  @{ Name = "diagnose";      Method = "POST"; Path = "/api/diagnose" },
  @{ Name = "whoami";        Method = "GET";  Path = "/.netlify/functions/whoami" },
  @{ Name = "archive";       Method = "GET";  Path = "/.netlify/functions/archive" },
  @{ Name = "archive-import"; Method = "POST"; Path = "/.netlify/functions/archive-import" },
  @{ Name = "archive-note";  Method = "POST"; Path = "/.netlify/functions/archive-note" }
)

# Sends one request and returns status, the demo header and the body (also for 4xx/5xx).
function Send($ep, $password) {
  $headers = @{}
  if ($password) { $headers["x-repostrx-password"] = $password }
  $request = @{ Uri = $Base + $ep.Path; Method = $ep.Method; Headers = $headers; UseBasicParsing = $true }
  if ($ep.Method -eq "POST") { $request.Body = "{}"; $request.ContentType = "application/json" }
  try {
    $r = Invoke-WebRequest @request
    return @{ Status = [int]$r.StatusCode; Demo = $r.Headers["x-repostrx-demo"]; Body = $r.Content }
  } catch {
    $resp = $_.Exception.Response
    if (-not $resp) { return @{ Status = 0; Demo = $null; Body = $_.Exception.Message } }
    $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
    return @{ Status = [int]$resp.StatusCode; Demo = $resp.Headers["x-repostrx-demo"]; Body = $reader.ReadToEnd() }
  }
}

$pass = 0; $fail = 0
function Check($label, $ep, $password, $expected) {
  $r = Send $ep $password
  # "allowed" = got past the password check (anything except 401 or 403).
  $ok = if ($expected -eq "allowed") { $r.Status -notin 0, 401, 403 } else { $r.Status -eq $expected }
  if ($ok) { $script:pass++ } else { $script:fail++ }
  $mark = if ($ok) { "PASS" } else { "FAIL" }
  $body = $r.Body; if ($body.Length -gt 110) { $body = $body.Substring(0, 110) + "..." }
  "{0}  {1,-6} {2,-14} expected {3}, got {4}  {5}" -f $mark, $label, $ep.Name, $expected, $r.Status, $body
}

Write-Host "Testing $Base"
$owner = Read-Secret "Owner password (REPOSTRX_APP_PASSWORD)"
$demo  = Read-Secret "Demo password (REPOSTRX_DEMO_PASSWORD), or press Enter to skip"

foreach ($ep in $endpoints) { Check "none" $ep $null 401 }
foreach ($ep in $endpoints) { Check "wrong" $ep "wrong-password-123" 401 }

if ($demo) {
  # Demo is refused (403) where it could post or see your accounts or posts.
  # Elsewhere it gets past the password check and stops at the empty body (400),
  # except import-status, which asks Blotato (read-only) about the made-up ID.
  $demoExpected = @{
    "accounts" = 403; "schedule" = 403; "post-status" = 403; "archive" = 403; "archive-import" = 403; "archive-note" = 403
    "import" = 400; "drafts" = 400; "diagnose" = 400
    "import-status" = "allowed"; "whoami" = 200
  }
  foreach ($ep in $endpoints) { Check "demo" $ep $demo $demoExpected[$ep.Name] }
}

Check "owner" ($endpoints | Where-Object { $_.Name -eq "whoami" }) $owner 200
# Owner can read the archive (read-only; on localhost this is netlify dev's local copy).
Check "owner" ($endpoints | Where-Object { $_.Name -eq "archive" }) $owner 200

$owner = $null; $demo = $null
""
"$pass passed, $fail failed"
