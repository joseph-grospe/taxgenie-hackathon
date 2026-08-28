import * as pulumi from "@pulumi/pulumi";

const config = new pulumi.Config("taxgenie");

function isPlaceholderValue(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "replace-me" || normalized === "replace_me";
}

export function requiredString(name: string, envName?: string): string {
  const envValue = envName ? process.env[envName] : undefined;
  if (envValue && envValue.length > 0) {
    if (isPlaceholderValue(envValue)) {
      throw new Error(`${envName ?? name} must be set to a real value.`);
    }

    return envValue;
  }

  const configValue = config.require(name);
  if (isPlaceholderValue(configValue)) {
    throw new Error(`${name} must be set to a real value.`);
  }

  return configValue;
}

export function requiredSecret(name: string, envName?: string): pulumi.Output<string> {
  const envValue = envName ? process.env[envName] : undefined;
  if (envValue && envValue.length > 0) {
    if (isPlaceholderValue(envValue)) {
      throw new Error(`${envName ?? name} must be set to a real value.`);
    }

    return pulumi.secret(envValue);
  }

  return config.requireSecret(name);
}

export function optionalSecret(name: string, envName?: string): pulumi.Output<string | undefined> {
  const envValue = envName ? process.env[envName] : undefined;
  if (envValue && envValue.length > 0) {
    if (isPlaceholderValue(envValue)) {
      return pulumi.output(undefined);
    }

    return pulumi.secret(envValue);
  }

  return pulumi.output(config.getSecret(name));
}

export function optionalString(name: string, envName?: string): string | undefined {
  const envValue = envName ? process.env[envName] : undefined;
  if (envValue && envValue.length > 0) {
    if (isPlaceholderValue(envValue)) {
      return undefined;
    }

    return envValue;
  }

  const configValue = config.get(name);
  if (configValue && isPlaceholderValue(configValue)) {
    return undefined;
  }

  return configValue;
}

export function optionalStringList(name: string, envName?: string): string[] | undefined {
  const envValue = envName ? process.env[envName] : undefined;
  if (envValue && envValue.length > 0) {
    const items = envValue
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item && !isPlaceholderValue(item));

    return items.length > 0 ? items : undefined;
  }

  const configValue = config.getObject<string[]>(name);
  if (!configValue) {
    return undefined;
  }

  const items = configValue
    .map((item) => item.trim())
    .filter((item) => item && !isPlaceholderValue(item));

  return items.length > 0 ? items : undefined;
}
