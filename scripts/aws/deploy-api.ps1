param(
  [string]$Region = "eu-south-2",
  [string]$FunctionName = "pavilion-cms-api",
  [string]$ApiName = "pavilion-cms-api",
  [string]$RdsIdentifier = "pavilion-inventory-db",
  [string]$BucketName = "",
  [string]$ApiKey = ""
)

$ErrorActionPreference = "Stop"
if (Get-Variable PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
  $PSNativeCommandUseErrorActionPreference = $false
}
$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$ExportDir = Join-Path $Root "exports\aws-api"
$PackageDir = Join-Path $ExportDir "package"
$ZipPath = Join-Path $ExportDir "pavilion-cms-api.zip"
$EnvPath = Join-Path $ExportDir "lambda-env.json"
$VpcPath = Join-Path $ExportDir "lambda-vpc.json"
$OutPath = Join-Path $ExportDir "pavilion-api-env.txt"

function Require-Command($Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "$Name is not installed or not in PATH."
  }
}

function Resolve-AwsCli {
  $command = Get-Command aws -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }
  $defaultPath = "C:\Program Files\Amazon\AWSCLIV2\aws.exe"
  if (Test-Path $defaultPath) {
    Set-Alias -Name aws -Value $defaultPath -Scope Script
    return $defaultPath
  }
  throw "aws is not installed or not in PATH. Run npm run aws:install-cli first."
}

function Read-DotEnv($Path) {
  $map = @{}
  if (-not (Test-Path $Path)) { return $map }
  foreach ($line in Get-Content $Path) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith("#")) { continue }
    $idx = $trimmed.IndexOf("=")
    if ($idx -lt 1) { continue }
    $key = $trimmed.Substring(0, $idx).Trim()
    $value = $trimmed.Substring($idx + 1).Trim().Trim('"').Trim("'")
    $map[$key] = $value
  }
  return $map
}

function Write-Utf8NoBom($Path, $Content) {
  $encoding = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $encoding)
}

function AwsJson {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$AwsArgs)
  $json = & aws @AwsArgs --region $Region --output json
  if ($LASTEXITCODE -ne 0) { throw "aws $($AwsArgs -join ' ') failed" }
  if (-not $json) { return $null }
  return $json | ConvertFrom-Json
}

function AwsText {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$AwsArgs)
  $text = & aws @AwsArgs --region $Region --output text
  if ($LASTEXITCODE -ne 0) { throw "aws $($AwsArgs -join ' ') failed" }
  return $text
}

function AwsQuiet {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$AwsArgs)
  $previous = $ErrorActionPreference
  $ErrorActionPreference = "SilentlyContinue"
  & aws @AwsArgs --region $Region 1>$null 2>$null
  $code = $LASTEXITCODE
  $ErrorActionPreference = $previous
  return $code
}

$AwsCli = Resolve-AwsCli
Require-Command npm

New-Item -ItemType Directory -Force -Path $ExportDir | Out-Null
if (Test-Path $PackageDir) { Remove-Item -LiteralPath $PackageDir -Recurse -Force }
New-Item -ItemType Directory -Force -Path $PackageDir | Out-Null

$envMap = Read-DotEnv (Join-Path $Root ".env.production")
if (-not $envMap["DATABASE_URL"]) {
  $envMap = Read-DotEnv (Join-Path $Root ".env")
}
if (-not $envMap["DATABASE_URL"]) {
  throw "DATABASE_URL was not found in .env.production or .env."
}
$account = AwsText -AwsArgs @("sts", "get-caller-identity", "--query", "Account")
if (-not $BucketName) {
  $BucketName = "pavilion-cms-assets-$account-$Region"
}
if (-not $ApiKey) {
  $ApiKey = [guid]::NewGuid().ToString("N")
}

Write-Host "Checking AWS account and RDS..."
AwsJson -AwsArgs @("sts", "get-caller-identity") | Out-Null
$rds = AwsJson -AwsArgs @("rds", "describe-db-instances", "--db-instance-identifier", $RdsIdentifier)
$db = $rds.DBInstances[0]
$VpcId = $db.DBSubnetGroup.VpcId
$SubnetIds = @($db.DBSubnetGroup.Subnets | ForEach-Object { $_.SubnetIdentifier })
$RdsSecurityGroupId = $db.VpcSecurityGroups[0].VpcSecurityGroupId

Write-Host "Creating or updating S3 bucket $BucketName..."
$bucketExists = $true
if ((AwsQuiet -AwsArgs @("s3api", "head-bucket", "--bucket", $BucketName)) -ne 0) { $bucketExists = $false }
if (-not $bucketExists) {
  & aws s3api create-bucket --bucket $BucketName --region $Region --create-bucket-configuration LocationConstraint=$Region | Out-Null
}
& aws s3api put-public-access-block --bucket $BucketName --public-access-block-configuration BlockPublicAcls=false,IgnorePublicAcls=false,BlockPublicPolicy=false,RestrictPublicBuckets=false --region $Region | Out-Null
$bucketPolicy = @{
  Version = "2012-10-17"
  Statement = @(
    @{
      Sid = "PublicReadProductAssets"
      Effect = "Allow"
      Principal = "*"
      Action = "s3:GetObject"
      Resource = "arn:aws:s3:::$BucketName/*"
    }
  )
} | ConvertTo-Json -Depth 8
$BucketPolicyPath = Join-Path $ExportDir "bucket-policy.json"
Write-Utf8NoBom $BucketPolicyPath $bucketPolicy
& aws s3api put-bucket-policy --bucket $BucketName --policy file://$BucketPolicyPath --region $Region | Out-Null
$cors = @{
  CORSRules = @(
    @{
      AllowedHeaders = @("*")
      AllowedMethods = @("GET", "PUT", "POST", "HEAD")
      AllowedOrigins = @("*")
      ExposeHeaders = @("ETag")
      MaxAgeSeconds = 3000
    }
  )
} | ConvertTo-Json -Depth 8
$CorsPath = Join-Path $ExportDir "bucket-cors.json"
Write-Utf8NoBom $CorsPath $cors
& aws s3api put-bucket-cors --bucket $BucketName --cors-configuration file://$CorsPath --region $Region | Out-Null

Write-Host "Creating Lambda IAM role..."
$RoleName = "$FunctionName-role"
$RoleArn = ""
try {
  $RoleArn = AwsText -AwsArgs @("iam", "get-role", "--role-name", $RoleName, "--query", "Role.Arn")
} catch {
  $trust = @{
    Version = "2012-10-17"
    Statement = @(
      @{
        Effect = "Allow"
        Principal = @{ Service = "lambda.amazonaws.com" }
        Action = "sts:AssumeRole"
      }
    )
  } | ConvertTo-Json -Depth 8
  $TrustPath = Join-Path $ExportDir "lambda-trust.json"
  Write-Utf8NoBom $TrustPath $trust
  $createdRole = AwsJson -AwsArgs @("iam", "create-role", "--role-name", $RoleName, "--assume-role-policy-document", "file://$TrustPath")
  $RoleArn = $createdRole.Role.Arn
  Start-Sleep -Seconds 10
}
& aws iam attach-role-policy --role-name $RoleName --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole | Out-Null
& aws iam attach-role-policy --role-name $RoleName --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole | Out-Null
$s3Policy = @{
  Version = "2012-10-17"
  Statement = @(
    @{
      Effect = "Allow"
      Action = @("s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket")
      Resource = @("arn:aws:s3:::$BucketName", "arn:aws:s3:::$BucketName/*")
    }
  )
} | ConvertTo-Json -Depth 8
$S3PolicyPath = Join-Path $ExportDir "lambda-s3-policy.json"
Write-Utf8NoBom $S3PolicyPath $s3Policy
& aws iam put-role-policy --role-name $RoleName --policy-name "$FunctionName-s3" --policy-document file://$S3PolicyPath | Out-Null

Write-Host "Creating Lambda security group and RDS ingress..."
$SgName = "$FunctionName-sg"
$LambdaSecurityGroupId = AwsText -AwsArgs @("ec2", "describe-security-groups", "--filters", "Name=group-name,Values=$SgName", "Name=vpc-id,Values=$VpcId", "--query", "SecurityGroups[0].GroupId")
if ($LambdaSecurityGroupId -eq "None" -or -not $LambdaSecurityGroupId) {
  $LambdaSecurityGroupId = AwsText -AwsArgs @("ec2", "create-security-group", "--group-name", $SgName, "--description", "Pavilion CMS API Lambda security group", "--vpc-id", $VpcId, "--query", "GroupId")
}
AwsQuiet -AwsArgs @("ec2", "authorize-security-group-ingress", "--group-id", $RdsSecurityGroupId, "--protocol", "tcp", "--port", "5432", "--source-group", $LambdaSecurityGroupId) | Out-Null

Write-Host "Packaging API..."
Copy-Item -Recurse -Path (Join-Path $Root "api") -Destination (Join-Path $PackageDir "api")
New-Item -ItemType Directory -Force -Path (Join-Path $PackageDir "electron") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $PackageDir "scripts\db") | Out-Null
Copy-Item -Path (Join-Path $Root "electron\database.cjs") -Destination (Join-Path $PackageDir "electron\database.cjs")
Copy-Item -Path (Join-Path $Root "electron\cloudSync.cjs") -Destination (Join-Path $PackageDir "electron\cloudSync.cjs")
Copy-Item -Path (Join-Path $Root "scripts\db\common.cjs") -Destination (Join-Path $PackageDir "scripts\db\common.cjs")
Copy-Item -Path (Join-Path $Root "scripts\db\import-localstorage.cjs") -Destination (Join-Path $PackageDir "scripts\db\import-localstorage.cjs")
Copy-Item -Path (Join-Path $Root "api\package.json") -Destination (Join-Path $PackageDir "package.json")
Push-Location $PackageDir
npm install --omit=dev
Pop-Location
if (Test-Path $ZipPath) { Remove-Item -LiteralPath $ZipPath -Force }
Compress-Archive -Path (Join-Path $PackageDir "*") -DestinationPath $ZipPath -Force

$lambdaEnv = @{
  Variables = @{
    DATABASE_URL = $envMap["DATABASE_URL"]
    PGSSL = "true"
    PGSSL_REJECT_UNAUTHORIZED = "false"
    S3_BUCKET = $BucketName
    S3_BASE_PREFIX = "products"
    API_KEY = $ApiKey
    CORS_ORIGIN = "*"
  }
} | ConvertTo-Json -Depth 8
Write-Utf8NoBom $EnvPath $lambdaEnv

$lambdaVpc = @{
  SubnetIds = $SubnetIds
  SecurityGroupIds = @($LambdaSecurityGroupId)
} | ConvertTo-Json -Depth 8
Write-Utf8NoBom $VpcPath $lambdaVpc

Write-Host "Creating or updating Lambda function..."
$functionExists = $true
if ((AwsQuiet -AwsArgs @("lambda", "get-function", "--function-name", $FunctionName)) -ne 0) { $functionExists = $false }
if (-not $functionExists) {
  & aws lambda create-function `
    --function-name $FunctionName `
    --runtime nodejs20.x `
    --role $RoleArn `
    --handler api/handler.handler `
    --zip-file fileb://$ZipPath `
    --timeout 30 `
    --memory-size 512 `
    --vpc-config file://$VpcPath `
    --environment file://$EnvPath `
    --region $Region | Out-Null
} else {
  & aws lambda update-function-code --function-name $FunctionName --zip-file fileb://$ZipPath --region $Region | Out-Null
  & aws lambda wait function-updated --function-name $FunctionName --region $Region
  & aws lambda update-function-configuration `
    --function-name $FunctionName `
    --timeout 30 `
    --memory-size 512 `
    --vpc-config file://$VpcPath `
    --environment file://$EnvPath `
    --region $Region | Out-Null
}
& aws lambda wait function-updated --function-name $FunctionName --region $Region
$FunctionArn = AwsText -AwsArgs @("lambda", "get-function", "--function-name", $FunctionName, "--query", "Configuration.FunctionArn")

Write-Host "Creating or updating HTTP API Gateway..."
$ApiId = AwsText -AwsArgs @("apigatewayv2", "get-apis", "--query", "Items[?Name=='$ApiName'].ApiId | [0]")
if ($ApiId -eq "None" -or -not $ApiId) {
  $ApiId = AwsText -AwsArgs @("apigatewayv2", "create-api", "--name", $ApiName, "--protocol-type", "HTTP", "--query", "ApiId")
}
$IntegrationId = AwsText -AwsArgs @("apigatewayv2", "get-integrations", "--api-id", $ApiId, "--query", "Items[?IntegrationUri=='$FunctionArn'].IntegrationId | [0]")
if ($IntegrationId -eq "None" -or -not $IntegrationId) {
  $IntegrationId = AwsText -AwsArgs @("apigatewayv2", "create-integration", "--api-id", $ApiId, "--integration-type", "AWS_PROXY", "--integration-uri", $FunctionArn, "--payload-format-version", "2.0", "--query", "IntegrationId")
}
foreach ($RouteKey in @("ANY /{proxy+}", "ANY /")) {
  $routeId = AwsText -AwsArgs @("apigatewayv2", "get-routes", "--api-id", $ApiId, "--query", "Items[?RouteKey=='$RouteKey'].RouteId | [0]")
  if ($routeId -eq "None" -or -not $routeId) {
    & aws apigatewayv2 create-route --api-id $ApiId --route-key $RouteKey --target "integrations/$IntegrationId" --region $Region | Out-Null
  }
}
$stageId = AwsText -AwsArgs @("apigatewayv2", "get-stages", "--api-id", $ApiId, "--query", "Items[?StageName=='`$default'].StageName | [0]")
if ($stageId -eq "None" -or -not $stageId) {
  & aws apigatewayv2 create-stage --api-id $ApiId --stage-name '$default' --auto-deploy --region $Region | Out-Null
} else {
  & aws apigatewayv2 update-stage --api-id $ApiId --stage-name '$default' --auto-deploy --region $Region | Out-Null
}
AwsQuiet -AwsArgs @("lambda", "add-permission", "--function-name", $FunctionName, "--statement-id", "$FunctionName-apigw", "--action", "lambda:InvokeFunction", "--principal", "apigateway.amazonaws.com", "--source-arn", "arn:aws:execute-api:$Region`:$account`:$ApiId/*/*/*") | Out-Null

$ApiBaseUrl = "https://$ApiId.execute-api.$Region.amazonaws.com"
@"
API_BASE_URL=$ApiBaseUrl
API_KEY=$ApiKey
S3_BUCKET=$BucketName
AWS_REGION=$Region
"@ | ForEach-Object { Write-Utf8NoBom $OutPath $_ }

Write-Host ""
Write-Host "Deployment complete."
Write-Host "API_BASE_URL=$ApiBaseUrl"
Write-Host "API_KEY saved to $OutPath"
Write-Host "S3_BUCKET=$BucketName"
