import * as pulumi from "@pulumi/pulumi";

const config = new pulumi.Config("taxtrack");

export function requiredString(name: string, envName?: string): string {
  const envValue = envName ? process.env[envName] : undefined;
  if (envValue && envValue.length > 0) {
    return envValue;
  }

  return config.require(name);
}

export function requiredSecret(name: string, envName?: string): pulumi.Output<string> {
  const envValue = envName ? process.env[envName] : undefined;
  if (envValue && envValue.length > 0) {
    return pulumi.secret(envValue);
  }

  return config.requireSecret(name);
}

export function optionalSecret(name: string, envName?: string): pulumi.Output<string | undefined> {
  const envValue = envName ? process.env[envName] : undefined;
  if (envValue && envValue.length > 0) {
    return pulumi.secret(envValue);
  }

  return pulumi.output(config.getSecret(name));
}

export function optionalString(name: string, envName?: string): string | undefined {
  const envValue = envName ? process.env[envName] : undefined;
  if (envValue && envValue.length > 0) {
    return envValue;
  }

  return config.get(name);
}

export function optionalStringList(name: string, envName?: string): string[] | undefined {
  const envValue = envName ? process.env[envName] : undefined;
  if (envValue && envValue.length > 0) {
    return envValue
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return config.getObject<string[]>(name);
}
