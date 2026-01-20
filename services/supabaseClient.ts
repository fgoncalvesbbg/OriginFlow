
import { createClient } from '@supabase/supabase-js';

// Supabase Connection Details
const SUPABASE_URL = 'https://ecueltibpmpnhnaxlskx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVjdWVsdGlicG1wbmhuYXhsc2t4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM1OTE2NTksImV4cCI6MjA3OTE2NzY1OX0.Z6H1vSj239ur6ZDgjsBXESAwsuaM23RtvPLXWu0Ymqw';

export const isLive = true;

// Standard Supabase client initialization. 
// The SDK handles apikey and authorization headers automatically.
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
