/**
 * @fileoverview Provides a service class (`OpenRouterProvider`) for interacting with the
 * OpenRouter API. This file implements the "handler" pattern internally, where the
 * OpenRouterProvider class manages state and error handling, while private logic functions
 * execute the core API interactions and throw structured errors.
 * @module src/services/llm-providers/openRouterProvider
 */
import { config } from "../../config/index.js";
import { BaseErrorCode, McpError } from "../../types-global/errors.js";
import { ErrorHandler } from "../../utils/internal/errorHandler.js";
import { logger } from "../../utils/internal/logger.js";
import {
  RequestContext,
  requestContextService,
} from "../../utils/internal/requestContext.js";
import { rateLimiter } from "../../utils/security/rateLimiter.js";
import { sanitization } from "../../utils/security/sanitization.js";

/**
 * Lazy-loaded OpenAI module to reduce initial bundle size and startup time.
 * @private
 */
let openaiModule: typeof import("openai") | null = null;

/**
 * Lazily loads the OpenAI module only when needed.
 * @private
 */
async function getOpenAIModule() {
  if (!openaiModule) {
    openaiModule = await import("openai");
  }
  return openaiModule;
}

// Note: OpenRouter recommends setting HTTP-Referer (e.g., config.openrouterAppUrl)
// and X-Title (e.g., config.openrouterAppName) headers.

/**
 * Options for configuring the OpenRouter client.
 */
export interface OpenRouterClientOptions {
  apiKey?: string;
  baseURL?: string;
  siteUrl?: string;
  siteName?: string;
}

/**
 * Defines the parameters for an OpenRouter chat completion request.
 */
export type OpenRouterChatParams = (
  | import("openai/resources/chat/completions").ChatCompletionCreateParamsNonStreaming
  | import("openai/resources/chat/completions").ChatCompletionCreateParamsStreaming
) & {
  top_k?: number;
  min_p?: number;
  transforms?: string[];
  models?: string[];
  route?: "fallback";
};

/**
 * Service class for interacting with the OpenRouter API.
 * Provides methods for chat completions with streaming and non-streaming options.
 */
export class OpenRouterProvider {
  private client: InstanceType<typeof import("openai").default> | null = null;
  private readonly options: OpenRouterClientOptions;

  constructor(options: OpenRouterClientOptions = {}) {
    this.options = {
      apiKey: options.apiKey || config.openrouterApiKey,
      baseURL: options.baseURL || "https://openrouter.ai/api/v1",
      siteUrl: options.siteUrl || config.openrouterAppUrl,
      siteName: options.siteName || config.openrouterAppName,
      ...options,
    };
  }

  /**
   * Lazily initializes the OpenAI client when needed.
   * @private
   */
  private async ensureClient(): Promise<InstanceType<typeof import("openai").default>> {
    if (!this.client) {
      const OpenAI = await getOpenAIModule();
      
      if (!this.options.apiKey) {
        throw new McpError(
          BaseErrorCode.CONFIGURATION_ERROR,
          "OpenRouter API key is required but not provided in configuration or options.",
        );
      }

      this.client = new OpenAI.default({
        apiKey: this.options.apiKey,
        baseURL: this.options.baseURL,
        defaultHeaders: {
          ...(this.options.siteUrl && { "HTTP-Referer": this.options.siteUrl }),
          ...(this.options.siteName && { "X-Title": this.options.siteName }),
        },
      });
    }
    return this.client;
  }

  /**
   * Creates a chat completion request to OpenRouter.
   * Supports both streaming and non-streaming responses.
   *
   * @param params - The chat completion parameters.
   * @param context - Optional request context for logging and error handling.
   * @returns A promise that resolves to either a ChatCompletion or Stream based on the stream parameter.
   * @throws {McpError} If the request fails or parameters are invalid.
   */
  async createChatCompletion<T extends OpenRouterChatParams>(
    params: T,
    context?: RequestContext,
  ): Promise<
    T extends { stream: true }
      ? import("openai/streaming").Stream<import("openai/resources/chat/completions").ChatCompletionChunk>
      : import("openai/resources/chat/completions").ChatCompletion
  > {
    const operationContext = context || requestContextService.createRequestContext({
      operation: "OpenRouterProvider.createChatCompletion",
    });

    return ErrorHandler.tryCatch(
      async () => {
        // Rate limiting
        await rateLimiter.check("openrouter", operationContext);

        // Input sanitization
        const sanitizedParams = await this.sanitizeParams(params, operationContext);

        // Get the client (lazy initialization)
        const client = await this.ensureClient();

        // Make the API call
        const result = await client.chat.completions.create(sanitizedParams as any);

        logger.info("OpenRouter chat completion request successful.", {
          ...operationContext,
          model: params.model,
          streaming: params.stream ?? false,
        });

        return result as any;
      },
      {
        operation: "OpenRouterProvider.createChatCompletion",
        context: operationContext,
        input: {
          model: params.model,
          messageCount: params.messages?.length,
          streaming: params.stream ?? false,
        },
        errorCode: BaseErrorCode.INTERNAL_ERROR,
      },
    );
  }

  /**
   * Sanitizes the input parameters for the chat completion request.
   * @private
   */
  private async sanitizeParams(
    params: OpenRouterChatParams,
    context: RequestContext,
  ): Promise<OpenRouterChatParams> {
    return ErrorHandler.tryCatch(
      async () => {
        // Validate required fields
        if (!params.model) {
          throw new McpError(
            BaseErrorCode.INTERNAL_ERROR,
            "Model parameter is required for chat completion.",
            context,
          );
        }

        if (!params.messages || !Array.isArray(params.messages) || params.messages.length === 0) {
          throw new McpError(
            BaseErrorCode.INTERNAL_ERROR,
            "Messages array is required and must contain at least one message.",
            context,
          );
        }

        // Sanitize string parameters
        const sanitizedParams: OpenRouterChatParams = {
          ...params,
          model: await sanitization.sanitizeString(params.model, { context: "text" }),
        };

        // Sanitize message contents
        if (sanitizedParams.messages) {
          sanitizedParams.messages = await Promise.all(
            sanitizedParams.messages.map(async (message) => {
              const sanitizedMessage = { ...message };
              
              if (typeof message.content === "string") {
                sanitizedMessage.content = await sanitization.sanitizeString(
                  message.content,
                  { context: "text" },
                );
              } else if (Array.isArray(message.content)) {
                sanitizedMessage.content = message.content as any;
              }
              
              return sanitizedMessage;
            }),
          );
        }

        return sanitizedParams;
      },
      {
        operation: "OpenRouterProvider.sanitizeParams",
        context,
        errorCode: BaseErrorCode.INTERNAL_ERROR,
      },
    );
  }

  /**
   * Gets the underlying OpenAI client instance.
   * Initializes the client if not already done.
   * @returns The OpenAI client instance.
   */
  async getClient(): Promise<InstanceType<typeof import("openai").default>> {
    return this.ensureClient();
  }

  /**
   * Checks if the provider is configured with required credentials.
   * @returns True if the provider has the necessary configuration.
   */
  isConfigured(): boolean {
    return !!(this.options.apiKey && this.options.baseURL);
  }

  /**
   * Legacy initialize method for backward compatibility.
   * This is a no-op since initialization is now lazy.
   */
  initialize(): void {
    // No-op for backward compatibility
  }

  /**
   * Legacy streaming method for backward compatibility.
   * Creates a streaming chat completion.
   */
  async chatCompletionStream(
    params: OpenRouterChatParams,
    context?: RequestContext,
  ): Promise<any> {
    const streamParams = { ...params, stream: true };
    return this.createChatCompletion(streamParams, context);
  }
}

/**
 * Default OpenRouter provider instance using configuration values.
 */
export const openRouterProvider = new OpenRouterProvider();
