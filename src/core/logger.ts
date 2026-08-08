export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export type LogRecord = {
  readonly level: LogLevel;
  readonly scope: string;
  readonly message: string;
  readonly at: string;
  readonly data?: Record<string, unknown>;
};

export interface Logger {
  child(scope: string): Logger;
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

/**
 * Structured console logger used by every tool.
 * Logs are JSON so benchmarks and future UIs can parse them without guessing.
 */
export class JsonConsoleLogger implements Logger {
  public constructor(
    private readonly scope: string = "harness",
    private readonly minLevel: LogLevel = "info",
  ) {}

  public child(scope: string): Logger {
    return new JsonConsoleLogger(`${this.scope}.${scope}`, this.minLevel);
  }

  public debug(message: string, data?: Record<string, unknown>): void {
    this.write("debug", message, data);
  }

  public info(message: string, data?: Record<string, unknown>): void {
    this.write("info", message, data);
  }

  public warn(message: string, data?: Record<string, unknown>): void {
    this.write("warn", message, data);
  }

  public error(message: string, data?: Record<string, unknown>): void {
    this.write("error", message, data);
  }

  private write(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[this.minLevel]) {
      return;
    }

    const record: LogRecord = {
      level,
      scope: this.scope,
      message,
      at: new Date().toISOString(),
      ...(data === undefined ? {} : { data }),
    };

    const line = JSON.stringify(record);
    if (level === "error") {
      console.error(line);
      return;
    }
    console.log(line);
  }
}
