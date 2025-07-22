/**
 * @fileoverview Provides a singleton Logger class that wraps Winston for file logging
 * and supports sending MCP (Model Context Protocol) `notifications/message`.
 * It handles different log levels compliant with RFC 5424 and MCP specifications.
 * @module src/utils/internal/logger
 */
import path from "path";
import { config } from "../../config/index.js";
import { RequestContext } from "./requestContext.js";

/**
 * Defines the supported logging levels based on RFC 5424 Syslog severity levels,
 * as used by the Model Context Protocol (MCP).
 * Levels are: 'debug'(7), 'info'(6), 'notice'(5), 'warning'(4), 'error'(3), 'crit'(2), 'alert'(1), 'emerg'(0).
 * Lower numeric values indicate higher severity.
 */
export type McpLogLevel =
  | "debug"
  | "info"
  | "notice"
  | "warning"
  | "error"
  | "crit"
  | "alert"
  | "emerg";

/**
 * Numeric severity mapping for MCP log levels (lower is more severe).
 * @private
 */
const mcpLevelSeverity: Record<McpLogLevel, number> = {
  emerg: 0,
  alert: 1,
  crit: 2,
  error: 3,
  warning: 4,
  notice: 5,
  info: 6,
  debug: 7,
};

/**
 * Maps MCP log levels to Winston's core levels for file logging.
 * @private
 */
const mcpToWinstonLevel: Record<
  McpLogLevel,
  "debug" | "info" | "warn" | "error"
> = {
  debug: "debug",
  info: "info",
  notice: "info",
  warning: "warn",
  error: "error",
  crit: "error",
  alert: "error",
  emerg: "error",
};

/**
 * Lazy-loaded Winston module to reduce initial bundle size and startup time.
 * @private
 */
let winstonModule: typeof import("winston") | null = null;

/**
 * Lazily loads Winston modules only when needed.
 * @private
 */
async function getWinstonModules() {
  if (!winstonModule) {
    winstonModule = (await import("winston")).default;
  }
  return winstonModule;
}

/**
 * Formats log entries consistently for file output and console display.
 * @private
 */
function createLogFormatter() {
  return {
    timestamp: () => new Date().toISOString(),
    json: (info: any) => JSON.stringify({
      timestamp: new Date().toISOString(),
      level: info.level,
      message: info.message,
      ...info.meta
    }),
    simple: (info: any) => `${new Date().toISOString()} [${info.level.toUpperCase()}] ${info.message}`
  };
}

/**
 * Singleton Logger class with lazy initialization.
 */
class Logger {
  private winstonLogger: InstanceType<typeof import("winston").Logger> | null = null;
  private isInitialized = false;
  private initializationPromise: Promise<void> | null = null;
  private logLevel: McpLogLevel = "info";

  /**
   * Ensures the logger is initialized before use.
   * @private
   */
  private async ensureInitialized(): Promise<void> {
    if (this.isInitialized) return;
    
    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    this.initializationPromise = this.doInitialize();
    return this.initializationPromise;
  }

  /**
   * Performs the actual initialization of the Winston logger.
   * @private
   */
  private async doInitialize(): Promise<void> {
    const winston = await getWinstonModules();

    // Create log directory if it doesn't exist
    const logDir = config.logsPath || './logs';
    
    try {
      const fs = await import('fs/promises');
      await fs.mkdir(logDir, { recursive: true });
    } catch (error) {
      // Fallback to console logging if we can't create the directory
      console.warn(`Could not create log directory ${logDir}:`, error);
    }

    const transports: any[] = [];

    // File transport (if directory exists)
    try {
      const logFile = path.join(logDir, `${config.mcpServerName || 'mcp-server'}.log`);
      transports.push(
        new winston.transports.File({
          filename: logFile,
          level: mcpToWinstonLevel[this.logLevel],
          format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.json()
          ),
          maxsize: 5242880, // 5MB
          maxFiles: 5,
        })
      );
    } catch (error) {
      console.warn('File logging disabled due to initialization error:', error);
    }

    // Console transport (for development)
    if (process.env.NODE_ENV !== 'production') {
      transports.push(
        new winston.transports.Console({
          level: mcpToWinstonLevel[this.logLevel],
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
          ),
        })
      );
    }

    this.winstonLogger = winston.createLogger({
      level: mcpToWinstonLevel[this.logLevel],
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      transports,
      exitOnError: false,
    });

    this.isInitialized = true;
  }

  /**
   * Initializes the logger with the specified log level.
   */
  async initialize(level: McpLogLevel = "info"): Promise<void> {
    this.logLevel = level;
    await this.ensureInitialized();
  }

  /**
   * Formats context for logging.
   * @private
   */
  private formatContext(context?: RequestContext): any {
    if (!context) return {};
    
    return {
      requestId: context.requestId,
      operation: context.operation,
      timestamp: context.timestamp,
      applicationName: context.applicationName,
      applicationVersion: context.applicationVersion,
      nodeEnvironment: context.nodeEnvironment,
      correlationId: context.correlationId,
    };
  }

  /**
   * Logs a debug message.
   */
  debug(message: string, context?: RequestContext): void {
    if (this.isInitialized && this.winstonLogger) {
      this.winstonLogger.debug(message, this.formatContext(context));
    } else if (process.env.NODE_ENV !== 'production') {
      // Only show debug in development
      console.debug(`[DEBUG] ${message}`, context ? JSON.stringify(this.formatContext(context)) : '');
    }
  }

  /**
   * Logs an info message.
   */
  info(message: string, context?: RequestContext): void {
    if (this.isInitialized && this.winstonLogger) {
      this.winstonLogger.info(message, this.formatContext(context));
    } else {
      // Fallback to console for critical messages when logger isn't ready
      console.log(`[INFO] ${message}`, context ? JSON.stringify(this.formatContext(context)) : '');
    }
  }

  /**
   * Logs a notice message.
   */
  notice(message: string, context?: RequestContext): void {
    if (this.isInitialized && this.winstonLogger) {
      this.winstonLogger.info(`[NOTICE] ${message}`, this.formatContext(context));
    } else {
      console.log(`[NOTICE] ${message}`, context ? JSON.stringify(this.formatContext(context)) : '');
    }
  }

  /**
   * Logs a warning message.
   */
  warning(message: string, context?: RequestContext): void {
    if (this.isInitialized && this.winstonLogger) {
      this.winstonLogger.warn(message, this.formatContext(context));
    } else {
      // Fallback to console for critical messages when logger isn't ready
      console.warn(`[WARNING] ${message}`, context ? JSON.stringify(this.formatContext(context)) : '');
    }
  }

  /**
   * Logs an error message.
   */
  error(message: string, contextOrError?: RequestContext | Error, context?: RequestContext): void {
    const actualError = contextOrError instanceof Error ? contextOrError : undefined;
    const actualContext = contextOrError instanceof Error ? context : contextOrError;
    
    if (this.isInitialized && this.winstonLogger) {
      this.winstonLogger.error(message, { ...this.formatContext(actualContext), error: actualError });
    } else {
      // Fallback to console for critical messages when logger isn't ready
      console.error(`[ERROR] ${message}`, actualContext ? JSON.stringify(this.formatContext(actualContext)) : '', actualError);
    }
  }

  /**
   * Logs a critical message.
   */
  crit(message: string, contextOrError?: RequestContext | Error, context?: RequestContext): void {
    const actualError = contextOrError instanceof Error ? contextOrError : undefined;
    const actualContext = contextOrError instanceof Error ? context : contextOrError;
    
    if (this.isInitialized && this.winstonLogger) {
      this.winstonLogger.error(`[CRITICAL] ${message}`, { ...this.formatContext(actualContext), error: actualError });
    } else {
      console.error(`[CRITICAL] ${message}`, actualContext ? JSON.stringify(this.formatContext(actualContext)) : '', actualError);
    }
  }

  /**
   * Logs an alert message.
   */
  alert(message: string, contextOrError?: RequestContext | Error, context?: RequestContext): void {
    const actualError = contextOrError instanceof Error ? contextOrError : undefined;
    const actualContext = contextOrError instanceof Error ? context : contextOrError;
    
    if (this.isInitialized && this.winstonLogger) {
      this.winstonLogger.error(`[ALERT] ${message}`, { ...this.formatContext(actualContext), error: actualError });
    } else {
      console.error(`[ALERT] ${message}`, actualContext ? JSON.stringify(this.formatContext(actualContext)) : '', actualError);
    }
  }

  /**
   * Logs an emergency message.
   */
  emerg(message: string, contextOrError?: RequestContext | Error, context?: RequestContext): void {
    const actualError = contextOrError instanceof Error ? contextOrError : undefined;
    const actualContext = contextOrError instanceof Error ? context : contextOrError;
    
    if (this.isInitialized && this.winstonLogger) {
      this.winstonLogger.error(`[EMERGENCY] ${message}`, { ...this.formatContext(actualContext), error: actualError });
    } else {
      console.error(`[EMERGENCY] ${message}`, actualContext ? JSON.stringify(this.formatContext(actualContext)) : '', actualError);
    }
  }

  /**
   * Logs a fatal message (alias for emerg).
   */
  fatal(message: string, contextOrError?: RequestContext | Error, context?: RequestContext): void {
    this.emerg(message, contextOrError, context);
  }

  /**
   * Logs interaction data for debugging and monitoring.
   */
  logInteraction(type: string, data: {
    context?: RequestContext;
    request?: any;
    response?: any;
    error?: any;
    streaming?: boolean;
  }): void {
    const logData = {
      interactionType: type,
      timestamp: new Date().toISOString(),
      ...data,
      context: this.formatContext(data.context),
    };

    if (this.isInitialized && this.winstonLogger) {
      this.winstonLogger.info(`Interaction: ${type}`, logData);
    } else {
      console.log(`[INTERACTION] ${type}`, JSON.stringify(logData, null, 2));
    }
  }
}

/**
 * Singleton logger instance.
 */
export const logger = new Logger();
