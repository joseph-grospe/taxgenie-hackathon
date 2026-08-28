import * as aws from "@pulumi/aws";
import type { InfraContext } from "./types";

const CLOUDWATCH_AGENT_CONFIG_PATH =
  "/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json";
const LOG_RETENTION_DAYS = 14;

export function enableEc2CloudWatchLogging(
  ctx: InfraContext,
  input: {
    role: aws.iam.Role;
    service: string;
  }
) {
  new aws.iam.RolePolicyAttachment(`${ctx.namePrefix}-${input.service}-cloudwatch-agent`, {
    role: input.role.name,
    policyArn: aws.iam.ManagedPolicy.CloudWatchAgentServerPolicy
  });

  const logGroupName = `/taxgenie/${ctx.stage}/ec2/${input.service}`;
  const logGroup = new aws.cloudwatch.LogGroup(
    `${ctx.namePrefix}-${input.service}-logs`,
    {
      name: logGroupName,
      retentionInDays: LOG_RETENTION_DAYS
    }
  );

  const agentConfig = JSON.stringify(
    {
      agent: {
        run_as_user: "root"
      },
      logs: {
        logs_collected: {
          files: {
            collect_list: [
              {
                file_path: "/var/log/messages",
                log_group_name: logGroupName,
                log_stream_name: "{instance_id}/messages"
              },
              {
                file_path: "/var/log/cloud-init.log",
                log_group_name: logGroupName,
                log_stream_name: "{instance_id}/cloud-init"
              },
              {
                file_path: "/var/log/cloud-init-output.log",
                log_group_name: logGroupName,
                log_stream_name: "{instance_id}/cloud-init-output"
              },
              {
                file_path: "/var/log/amazon/ssm/amazon-ssm-agent.log",
                log_group_name: logGroupName,
                log_stream_name: "{instance_id}/ssm"
              },
              {
                file_path: "/var/lib/docker/containers/*/*.log",
                log_group_name: logGroupName,
                log_stream_name: "{instance_id}/containers"
              }
            ]
          }
        }
      }
    },
    null,
    2
  );

  return {
    logGroup,
    logGroupName,
    setupCommands: `
mkdir -p /opt/aws/amazon-cloudwatch-agent/etc
cat > ${CLOUDWATCH_AGENT_CONFIG_PATH} <<'CWCONFIG'
${agentConfig}
CWCONFIG
systemctl enable amazon-cloudwatch-agent
/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a stop || true
/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -c file:${CLOUDWATCH_AGENT_CONFIG_PATH} -s
`
  };
}
