$ErrorActionPreference = 'Stop'

$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$outputDirectory = Join-Path $repositoryRoot 'artifacts\demo-video'
$manifestPath = Join-Path $PSScriptRoot 'manifest.json'

New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
Add-Type -AssemblyName System.Runtime.WindowsRuntime
[void][Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media.SpeechSynthesis, ContentType = WindowsRuntime]
[void][Windows.Media.SpeechSynthesis.SpeechSynthesisStream, Windows.Media.SpeechSynthesis, ContentType = WindowsRuntime]

function Wait-WindowsRuntimeOperation {
  param(
    [Parameter(Mandatory)] $Operation,
    [Parameter(Mandatory)] [Type] $ResultType
  )

  $asTaskMethod = [System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object {
      $_.Name -eq 'AsTask' -and
      $_.IsGenericMethod -and
      $_.GetParameters().Count -eq 1
    } |
    Select-Object -First 1

  $task = $asTaskMethod.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
  $task.Wait()
  return $task.Result
}

$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
$synthesizer = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer
$synthesizer.Options.SpeakingRate = 1.0

try {
  foreach ($slide in $manifest.slides) {
    $target = Join-Path $outputDirectory $slide.audio
    $speechStream = Wait-WindowsRuntimeOperation `
      -Operation $synthesizer.SynthesizeTextToStreamAsync($slide.narration) `
      -ResultType ([Windows.Media.SpeechSynthesis.SpeechSynthesisStream])
    $inputStream = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($speechStream)
    $outputStream = [System.IO.File]::Create($target)
    try {
      $inputStream.CopyTo($outputStream)
    }
    finally {
      $outputStream.Dispose()
      $inputStream.Dispose()
      $speechStream.Dispose()
    }
  }
}
finally {
  $synthesizer.Dispose()
}

Get-ChildItem -LiteralPath $outputDirectory -Filter 'narration-*.wav' |
  Sort-Object Name |
  Select-Object Name, Length
