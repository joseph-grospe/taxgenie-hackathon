# AWS Permissions Needed for `sst deploy` (TaxTrack)

## Scope

This document is for deploying TaxTrack backend infra with:

```bash
TAXTRACK_INFRA_PROFILE=full TAXTRACK_INFRA_SCOPE=backend SST_STAGE=dev-backend \
pnpm --filter @taxtrack/infra exec sst deploy --stage dev-backend
```

AWS account: `202128604126`  
Region: `ap-southeast-1`

## Exact Permissions Failing in Current Logs

These are the actions explicitly denied in your latest deploy output:

- `ec2:CreateVpc`
- `rds:CreateDBClusterParameterGroup`
- `rds:CreateDBParameterGroup`
- `secretsmanager:CreateSecret`

## Minimum Unblock Permissions

Ask IT to allow these four actions first (for your IAM user/role) so the current deploy can move past the exact failures:

- `ec2:CreateVpc`
- `rds:CreateDBClusterParameterGroup`
- `rds:CreateDBParameterGroup`
- `secretsmanager:CreateSecret`

## Practical Backend Deploy Permission Set (Recommended)

To avoid repeated one-by-one failures on the next resources, request this deploy set for the backend scope:

### EC2 / VPC

- `ec2:CreateVpc`
- `ec2:DeleteVpc`
- `ec2:DescribeVpcs`
- `ec2:CreateSubnet`
- `ec2:DeleteSubnet`
- `ec2:DescribeSubnets`
- `ec2:CreateRouteTable`
- `ec2:DeleteRouteTable`
- `ec2:CreateRoute`
- `ec2:DeleteRoute`
- `ec2:AssociateRouteTable`
- `ec2:DisassociateRouteTable`
- `ec2:DescribeRouteTables`
- `ec2:CreateSecurityGroup`
- `ec2:DeleteSecurityGroup`
- `ec2:AuthorizeSecurityGroupIngress`
- `ec2:AuthorizeSecurityGroupEgress`
- `ec2:RevokeSecurityGroupIngress`
- `ec2:RevokeSecurityGroupEgress`
- `ec2:DescribeSecurityGroups`
- `ec2:CreateTags`
- `ec2:DeleteTags`
- `ec2:DescribeAvailabilityZones`

### RDS (Aurora)

- `rds:CreateDBCluster`
- `rds:ModifyDBCluster`
- `rds:DeleteDBCluster`
- `rds:DescribeDBClusters`
- `rds:CreateDBInstance`
- `rds:ModifyDBInstance`
- `rds:DeleteDBInstance`
- `rds:DescribeDBInstances`
- `rds:CreateDBSubnetGroup`
- `rds:DeleteDBSubnetGroup`
- `rds:DescribeDBSubnetGroups`
- `rds:CreateDBClusterParameterGroup`
- `rds:ModifyDBClusterParameterGroup`
- `rds:DeleteDBClusterParameterGroup`
- `rds:DescribeDBClusterParameterGroups`
- `rds:CreateDBParameterGroup`
- `rds:ModifyDBParameterGroup`
- `rds:DeleteDBParameterGroup`
- `rds:DescribeDBParameterGroups`
- `rds:AddTagsToResource`
- `rds:RemoveTagsFromResource`
- `rds:ListTagsForResource`

### Secrets Manager

- `secretsmanager:CreateSecret`
- `secretsmanager:DeleteSecret`
- `secretsmanager:DescribeSecret`
- `secretsmanager:GetSecretValue`
- `secretsmanager:PutSecretValue`
- `secretsmanager:UpdateSecret`
- `secretsmanager:TagResource`
- `secretsmanager:UntagResource`

### Lambda / CloudWatch Logs / IAM (Migration Hook)

- `lambda:CreateFunction`
- `lambda:UpdateFunctionCode`
- `lambda:UpdateFunctionConfiguration`
- `lambda:DeleteFunction`
- `lambda:InvokeFunction`
- `lambda:AddPermission`
- `lambda:RemovePermission`
- `logs:CreateLogGroup`
- `logs:PutRetentionPolicy`
- `iam:CreateRole`
- `iam:DeleteRole`
- `iam:AttachRolePolicy`
- `iam:DetachRolePolicy`
- `iam:PutRolePolicy`
- `iam:DeleteRolePolicy`
- `iam:GetRole`
- `iam:PassRole`

## Optional Extra Permissions if Deploying `all` Scope

If you deploy `TAXTRACK_INFRA_SCOPE=all` (not just backend), infra may also need EC2 instance/AMI permissions:

- `ec2:DescribeImages`
- `ec2:RunInstances`
- `ec2:TerminateInstances`
- `ec2:DescribeInstances`
- `ec2:CreateInternetGateway`
- `ec2:AttachInternetGateway`
- `ec2:DetachInternetGateway`
- `ec2:DeleteInternetGateway`

## Notes for IT

- If your org uses SCPs, these actions must be allowed by both SCP and identity policy.
- Permissions can be scoped to:
  - account: `202128604126`
  - region: `ap-southeast-1`
  - environment naming prefix: `taxtrack-dev-backend*`
