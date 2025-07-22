/**
 * @fileoverview Implements the DuckDB service for interacting with a DuckDB database.
 * This service provides a high-level interface for database operations including
 * initialization, query execution, transaction management, and connection handling.
 * @module services/duck-db/duckDBService
 */

import { BaseErrorCode, McpError } from "../../types-global/errors.js";
import {
  ErrorHandler,
  logger,
  RequestContext,
  requestContextService,
} from "../../utils/index.js";
import {
  DuckDBQueryResult,
  DuckDBServiceConfig,
  IDuckDBService,
} from "./types.js";

/**
 * Lazy-loaded DuckDB module to reduce initial bundle size and startup time.
 * @private
 */
let duckdbModule: typeof import("@duckdb/node-api") | null = null;

/**
 * Lazy-loaded connection manager to defer heavy initialization.
 * @private
 */
let DuckDBConnectionManagerClass: typeof import("./duckDBConnectionManager.js").DuckDBConnectionManager | null = null;

/**
 * Lazy-loaded query executor to defer heavy initialization.
 * @private
 */
let DuckDBQueryExecutorClass: typeof import("./duckDBQueryExecutor.js").DuckDBQueryExecutor | null = null;

/**
 * Lazily loads the DuckDB module and related classes only when needed.
 * @private
 */
async function loadDuckDBModules() {
  if (!duckdbModule) {
    const [duckdb, { DuckDBConnectionManager }, { DuckDBQueryExecutor }] = await Promise.all([
      import("@duckdb/node-api"),
      import("./duckDBConnectionManager.js"),
      import("./duckDBQueryExecutor.js")
    ]);
    
    duckdbModule = duckdb;
    DuckDBConnectionManagerClass = DuckDBConnectionManager;
    DuckDBQueryExecutorClass = DuckDBQueryExecutor;
  }
  
  return {
    duckdb: duckdbModule,
    DuckDBConnectionManager: DuckDBConnectionManagerClass!,
    DuckDBQueryExecutor: DuckDBQueryExecutorClass!
  };
}

export class DuckDBService implements IDuckDBService {
  private connectionManager: any = null;
  private queryExecutor: any = null;
  private initialized = false;

  constructor() {
    // Defer initialization until needed
  }

  async initialize(config?: DuckDBServiceConfig): Promise<void> {
    const context = requestContextService.createRequestContext({
      operation: "DuckDBService.initialize",
    });

    if (this.initialized) {
      throw new McpError(
        BaseErrorCode.INITIALIZATION_FAILED,
        "DuckDBService already initialized. Close first to re-initialize.",
        context,
      );
    }

    await ErrorHandler.tryCatch(
      async () => {
        const { DuckDBConnectionManager, DuckDBQueryExecutor } = await loadDuckDBModules();
        
        this.connectionManager = new DuckDBConnectionManager();
        const connection = await this.connectionManager.initialize(config);
        this.queryExecutor = new DuckDBQueryExecutor(connection);
        this.initialized = true;

        logger.info("DuckDBService initialized successfully.", context);
      },
      {
        operation: "DuckDBService.initialize",
        context,
        errorCode: BaseErrorCode.INITIALIZATION_FAILED,
        critical: true,
      },
    );
  }

  private ensureInitialized(): void {
    if (!this.initialized || !this.queryExecutor) {
      throw new McpError(
        BaseErrorCode.INITIALIZATION_FAILED,
        "DuckDBQueryExecutor not available. DuckDBService may not be fully initialized.",
      );
    }
  }

  private normalizeParams(
    params?: unknown[] | Record<string, unknown>,
  ): any {
    if (!params) return undefined;
    if (Array.isArray(params)) {
      return params;
    }
    throw new McpError(
      BaseErrorCode.INTERNAL_ERROR,
      "DuckDB service only supports array-style parameters, not named objects.",
    );
  }

  async run(
    sql: string,
    params?: unknown[] | Record<string, unknown>,
  ): Promise<void> {
    this.ensureInitialized();
    const context = requestContextService.createRequestContext({
      operation: "DuckDBService.run",
    });
    
    const normalizedParams = this.normalizeParams(params);
    return this.queryExecutor!.run(sql, normalizedParams, context);
  }

  async query<T = unknown>(
    sql: string,
    params?: unknown[] | Record<string, unknown>,
  ): Promise<DuckDBQueryResult<T>> {
    this.ensureInitialized();
    const context = requestContextService.createRequestContext({
      operation: "DuckDBService.query",
    });
    
    const normalizedParams = this.normalizeParams(params);
    return this.queryExecutor!.query(sql, normalizedParams, context);
  }

  async stream(
    sql: string,
    params?: unknown[] | Record<string, unknown>,
  ): Promise<any> {
    this.ensureInitialized();
    const context = requestContextService.createRequestContext({
      operation: "DuckDBService.stream",
    });
    
    const normalizedParams = this.normalizeParams(params);
    return this.queryExecutor!.stream(sql, normalizedParams, context);
  }

  async prepare(sql: string): Promise<any> {
    this.ensureInitialized();
    const context = requestContextService.createRequestContext({
      operation: "DuckDBService.prepare",
    });
    return this.queryExecutor!.prepare(sql, context);
  }

  async beginTransaction(): Promise<void> {
    this.ensureInitialized();
    const context = requestContextService.createRequestContext({
      operation: "DuckDBService.beginTransaction",
    });
    return this.queryExecutor!.beginTransaction(context);
  }

  async commitTransaction(): Promise<void> {
    this.ensureInitialized();
    const context = requestContextService.createRequestContext({
      operation: "DuckDBService.commitTransaction",
    });
    return this.queryExecutor!.commitTransaction(context);
  }

  async rollbackTransaction(): Promise<void> {
    this.ensureInitialized();
    const context = requestContextService.createRequestContext({
      operation: "DuckDBService.rollbackTransaction",
    });
    return this.queryExecutor!.rollbackTransaction(context);
  }

  async loadExtension(extensionName: string, repositoryPath?: string): Promise<void> {
    this.ensureInitialized();
    const context = requestContextService.createRequestContext({
      operation: "DuckDBService.loadExtension",
    });
    return this.queryExecutor!.loadExtension(extensionName, repositoryPath, context);
  }

  async close(): Promise<void> {
    const context = requestContextService.createRequestContext({
      operation: "DuckDBService.close",
    });

    await ErrorHandler.tryCatch(
      async () => {
        if (this.queryExecutor) {
          await this.queryExecutor.close();
          this.queryExecutor = null;
        }
        if (this.connectionManager) {
          await this.connectionManager.close();
          this.connectionManager = null;
        }
        this.initialized = false;
        logger.info("DuckDBService closed successfully.", context);
      },
      {
        operation: "DuckDBService.close",
        context,
        errorCode: BaseErrorCode.INTERNAL_ERROR,
      },
    );
  }

  getRawConnection(): any {
    return this.connectionManager?.getRawConnection() || null;
  }

  getRawInstance(): any {
    return this.connectionManager?.getRawInstance() || null;
  }
}
