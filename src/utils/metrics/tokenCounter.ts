/**
 * @fileoverview Provides utility functions for counting tokens in text and chat messages
 * using the `tiktoken` library, specifically configured for 'gpt-4o' tokenization.
 * These functions are essential for managing token limits and estimating costs
 * when interacting with language models.
 * @module src/utils/metrics/tokenCounter
 */
import { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { BaseErrorCode } from "../../types-global/errors.js";
import { ErrorHandler, logger, RequestContext } from "../index.js";

/**
 * The specific Tiktoken model used for all tokenization operations in this module.
 * This ensures consistent token counting.
 * @private
 */
const TOKENIZATION_MODEL = "gpt-4o" as const;

/**
 * Lazy-loaded tiktoken module to reduce initial bundle size and startup time.
 * @private
 */
let tiktokenModule: typeof import("tiktoken") | null = null;

/**
 * Lazily loads the tiktoken module only when needed.
 * @private
 */
async function getTiktokenModule() {
  if (!tiktokenModule) {
    tiktokenModule = await import("tiktoken");
  }
  return tiktokenModule;
}

/**
 * Calculates the number of tokens for a given text string using the
 * tokenizer specified by `TOKENIZATION_MODEL`.
 * Wraps tokenization in `ErrorHandler.tryCatch` for robust error management.
 *
 * @param text - The input text to tokenize.
 * @param context - Optional request context for logging and error handling.
 * @returns A promise that resolves with the number of tokens in the text.
 * @throws {McpError} If tokenization fails.
 */
export async function countTokens(
  text: string,
  context?: RequestContext,
): Promise<number> {
  return ErrorHandler.tryCatch(
    async () => {
      const tiktoken = await getTiktokenModule();
      let encoding: ReturnType<typeof tiktoken.encoding_for_model> | null = null;
      try {
        encoding = tiktoken.encoding_for_model(TOKENIZATION_MODEL);
        const tokens = encoding.encode(text);
        return tokens.length;
      } finally {
        encoding?.free();
      }
    },
    {
      operation: "countTokens",
      context: context,
      input: { textSample: text.substring(0, 50) + "..." },
      errorCode: BaseErrorCode.INTERNAL_ERROR,
    },
  );
}

/**
 * Calculates the total number of tokens for an array of chat completion message parameters.
 * This function processes each message in the array and provides a comprehensive token count
 * for the entire conversation, including message delimiters and formatting tokens.
 *
 * @param messages - Array of chat completion message parameters.
 * @param context - Optional request context for logging and error handling.
 * @returns A promise that resolves with the total number of tokens across all messages.
 * @throws {McpError} If tokenization fails for any message.
 */
export async function countTokensInMessages(
  messages: ChatCompletionMessageParam[],
  context?: RequestContext,
): Promise<number> {
  return ErrorHandler.tryCatch(
    async () => {
      const tiktoken = await getTiktokenModule();
      let encoding: ReturnType<typeof tiktoken.encoding_for_model> | null = null;
      
      try {
        encoding = tiktoken.encoding_for_model(TOKENIZATION_MODEL);
        let totalTokens = 0;

        for (const message of messages) {
          // Count tokens for role
          totalTokens += encoding.encode(message.role).length;
          
          // Count tokens for content
          if (typeof message.content === "string") {
            totalTokens += encoding.encode(message.content).length;
          } else if (Array.isArray(message.content)) {
            for (const contentItem of message.content) {
              if (contentItem.type === "text") {
                totalTokens += encoding.encode(contentItem.text).length;
              }
              // Note: For image content, we'd need additional logic
              // to estimate tokens based on image dimensions and detail level
            }
          }

          // Add tokens for message structure (approximately 3-4 tokens per message)
          totalTokens += 4;
        }

        return totalTokens;
      } finally {
        encoding?.free();
      }
    },
    {
      operation: "countTokensInMessages",
      context: context,
      input: { messageCount: messages.length },
      errorCode: BaseErrorCode.INTERNAL_ERROR,
    },
  );
}

/**
 * Estimates the number of tokens for a text string using a fast approximation.
 * This is useful for quick estimates without loading the full tiktoken library.
 * Uses approximately 4 characters per token as a rough estimate.
 *
 * @param text - The input text to estimate tokens for.
 * @returns The estimated number of tokens.
 */
export function estimateTokens(text: string): number {
  // Rough approximation: ~4 characters per token for English text
  // This is much faster than actual tokenization but less accurate
  return Math.ceil(text.length / 4);
}

/**
 * Determines whether to use fast estimation or accurate counting based on text length.
 * For very long texts, estimation might be preferred for performance.
 *
 * @param text - The input text.
 * @param threshold - Character threshold above which to use estimation (default: 10000).
 * @param context - Optional request context for logging and error handling.
 * @returns A promise that resolves with the token count.
 */
export async function countTokensAdaptive(
  text: string,
  threshold: number = 10000,
  context?: RequestContext,
): Promise<number> {
  if (text.length > threshold) {
    logger?.debug(`Using token estimation for large text (${text.length} chars)`, context);
    return estimateTokens(text);
  }
  return countTokens(text, context);
}
