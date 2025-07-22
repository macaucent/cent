/**
 * @fileoverview Initializes and exports a singleton Supabase client instance.
 * This module ensures that the Supabase client is initialized once and shared
 * across the application. It provides both a regular client and an admin client
 * with different access levels based on the provided keys.
 *
 * @module src/services/supabase/supabaseClient
 */

import { config } from "../../config/index.js";
import { BaseErrorCode, McpError } from "../../types-global/errors.js";
import { logger, requestContextService } from "../../utils/index.js";

/**
 * Type definition for the database schema (replace with your actual schema)
 */
type Database = any; // Replace with your actual database type

/**
 * Lazy-loaded Supabase module to reduce initial bundle size and startup time.
 * @private
 */
let supabaseModule: typeof import("@supabase/supabase-js") | null = null;

/**
 * Cached Supabase client instances
 * @private
 */
let supabase: ReturnType<typeof import("@supabase/supabase-js").createClient<Database>> | null = null;
let supabaseAdmin: ReturnType<typeof import("@supabase/supabase-js").createClient<Database>> | null = null;

/**
 * Lazily loads the Supabase module only when needed.
 * @private
 */
async function getSupabaseModule() {
  if (!supabaseModule) {
    supabaseModule = await import("@supabase/supabase-js");
  }
  return supabaseModule;
}

/**
 * Initializes Supabase clients lazily when first accessed.
 * @private
 */
async function initializeSupabase() {
  const context = requestContextService.createRequestContext({
    operation: "initializeSupabase",
  });

  if (config.supabase?.url && config.supabase?.anonKey) {
    const { createClient } = await getSupabaseModule();
    
    if (!supabase) {
      supabase = createClient<Database>(
        config.supabase.url,
        config.supabase.anonKey,
        {
          auth: {
            persistSession: false,
          },
        },
      );
      logger.info("Supabase client initialized.", context);
    }

    if (!supabaseAdmin && config.supabase.serviceRoleKey) {
      supabaseAdmin = createClient<Database>(
        config.supabase.url,
        config.supabase.serviceRoleKey,
        {
          auth: {
            persistSession: false,
          },
        },
      );
      logger.info("Supabase admin client initialized.", context);
    }
  } else {
    logger.warning(
      "Supabase URL or anon key is missing. Supabase clients not initialized.",
      context,
    );
  }
}

/**
 * Returns the singleton Supabase client instance.
 * Initializes the client on first access if not already initialized.
 * @returns The Supabase client.
 * @throws {McpError} If the client cannot be initialized due to missing configuration.
 */
export const getSupabaseClient = async (): Promise<ReturnType<typeof import("@supabase/supabase-js").createClient<Database>>> => {
  if (!supabase) {
    await initializeSupabase();
    
    if (!supabase) {
      throw new McpError(
        BaseErrorCode.CONFIGURATION_ERROR,
        "Supabase client has not been initialized. Please check your SUPABASE_URL and SUPABASE_ANON_KEY environment variables.",
      );
    }
  }
  return supabase;
};

/**
 * Returns the singleton Supabase admin client instance.
 * Initializes the client on first access if not already initialized.
 * @returns The Supabase admin client.
 * @throws {McpError} If the admin client cannot be initialized due to missing configuration.
 */
export const getSupabaseAdminClient = async (): Promise<ReturnType<typeof import("@supabase/supabase-js").createClient<Database>>> => {
  if (!supabaseAdmin) {
    await initializeSupabase();
    
    if (!supabaseAdmin) {
      throw new McpError(
        BaseErrorCode.CONFIGURATION_ERROR,
        "Supabase admin client has not been initialized. Please check your SUPABASE_SERVICE_ROLE_KEY environment variable.",
      );
    }
  }
  return supabaseAdmin;
};

/**
 * Checks if Supabase is configured without initializing the client.
 * @returns True if Supabase configuration is available.
 */
export const isSupabaseConfigured = (): boolean => {
  return !!(config.supabase?.url && config.supabase?.anonKey);
};

/**
 * Checks if Supabase admin is configured without initializing the client.
 * @returns True if Supabase admin configuration is available.
 */
export const isSupabaseAdminConfigured = (): boolean => {
  return !!(config.supabase?.url && config.supabase?.serviceRoleKey);
};
