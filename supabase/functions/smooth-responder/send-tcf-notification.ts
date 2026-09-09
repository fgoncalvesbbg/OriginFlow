// SUPABASE EDGE FUNCTION TEMPLATE: send-tcf-notification
// Deploy this via Supabase CLI:
// supabase functions deploy send-tcf-notification
//
// RECOVERED FROM PRODUCTION 2026-09-08 — see ../README.md before editing.
//
// THIS IS SUPERSEDED, DEAD CODE. Archived for the record, not for use.
//
//  - Deployed under slug `smooth-responder` (display name `send-submission-email`),
//    version 9, with this file — not index.ts — as the entrypoint. The directory and
//    filename here reproduce that layout exactly so the artifact stays faithful; that is
//    why the folder name does not match the code's own name.
//  - Superseded by ../send-tcf-notification/index.ts, which does the same job over the
//    Resend HTTP API. That file's own comment ("No broken SMTP libraries needed!") is the
//    epitaph for this one.
//  - UNREACHABLE from the app regardless: `triggerEmailNotification` in
//    src/services/shared/notification.service.ts is a stub that suppresses every send.
//  - The SMTP import below is UNPINNED (`deno.land/x/smtp/mod.ts` with no version), so a
//    redeploy would resolve to whatever is latest. Do not redeploy this without pinning.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { SmtpClient } from "https://deno.land/x/smtp/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { to, subject, html } = await req.json();

    // 1. CONFIGURE YOUR EMAIL PROVIDER HERE
    // Option A: Generic SMTP (Gmail/Outlook/etc)
    const client = new SmtpClient();

    await client.connectTLS({
      hostname: Deno.env.get("SMTP_HOST") || "smtp.gmail.com",
      port: 465,
      username: Deno.env.get("SMTP_USER"), // Your email
      password: Deno.env.get("SMTP_PASS"), // Your app password
    });

    await client.send({
      from: Deno.env.get("SMTP_USER")!,
      to: to,
      subject: subject,
      content: html,
      html: html,
    });

    await client.close();

       return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});
