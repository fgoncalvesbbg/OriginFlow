import { isLive } from '../config/environment.config';

/**
 * Centralized error handling utility
 * Parses various error types and provides user-friendly messages
 */
export const handleError = (error: any, context: string) => {
  if (!isLive) {
      throw new Error(`Connection error: Supabase is not configured. Please check your environment variables in Netlify.`);
  }
  console.error(`Error in ${context}:`, error);
  let msg = 'Unknown error';

  if (typeof error === 'string') {
      msg = error;
  } else if (error instanceof Error) {
      msg = error.message;
      if (error.name === 'AbortError') msg = 'Connection aborted (AbortError). Please retry.';
  } else if (typeof error === 'object' && error !== null) {
      msg = error.message || error.error_description || error.details || (error.error && error.error.message);

      if (!msg) {
          try {
              msg = JSON.stringify(error);
          } catch (e) {
              msg = 'Non-serializable error object';
          }
      }
  } else {
      msg = String(error);
  }

  if (msg.includes('PGRST116')) msg = 'Record not found (PGRST116)';
  if (msg.includes('PGRST204')) msg = 'Columns not found (PGRST204)';

  throw new Error(`${msg}`);
};
