// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
// @ts-nocheck
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Minimal CORS config so browsers can send POST/GET requests
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
}

const supabaseUrl = Deno.env.get("URL") || "";
const supabaseKey = Deno.env.get("KEY") || "";
const supabase = createClient(supabaseUrl, supabaseKey);
const CRYPTO_BOT_API_TOKEN = "339692:AAqnvlLFp9Zq8bGpFCRsXZ12hUZH8PeKsnM";

console.log("crypto-bot-webhook is up and ready for POST requests")

Deno.serve(async (req) => {
  // Log basic request info (do not consume body)
  console.log("crypto-bot-webhook request", {
    method: req.method,
    url: req.url,
    contentType: req.headers.get("content-type"),
    userAgent: req.headers.get("user-agent"),
  })

  // Respond to preflight checks
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (req.method === "GET") {
    return new Response(
      JSON.stringify({ status: "ok", message: "crypto-bot-webhook alive" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    )
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method Not Allowed" }),
      {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    )
  }

  // Safely parse body: prefer multipart/form-data (like create-invoice); fallback to JSON
  const contentType = req.headers.get("content-type") || ""
  let form: FormData | null = null
  let jsonBody: Record<string, unknown> = {}

  if (contentType.includes("multipart/form-data")) {
    try {
      form = await req.formData()
    } catch (err) {
      console.error("Failed to parse formData", err)
      // Fallback: attempt to read raw text to avoid crashing the handler
      await req.text().catch(()=>undefined)
      return new Response(
        JSON.stringify({ error: "Invalid or missing form-data body" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      )
    }
  } else if (contentType.includes("application/json")) {
    try {
      jsonBody = await req.json()
    } catch (err) {
      console.error("Failed to parse JSON body", err)
      return new Response(
        JSON.stringify({ error: "Invalid JSON body" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      )
    }
  } else if (contentType.includes("application/x-www-form-urlencoded")) {
    try {
      const raw = await req.text()
      const params = new URLSearchParams(raw)
      jsonBody = Object.fromEntries(params.entries())
    } catch (err) {
      console.error("Failed to parse urlencoded body", err)
      return new Response(
        JSON.stringify({ error: "Invalid urlencoded body" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      )
    }
  } else {
    // Unsupported content type
    await req.text().catch(()=>undefined) // drain to avoid reuse issues
    return new Response(
      JSON.stringify({ error: `Unsupported Content-Type: ${contentType}` }),
      {
        status: 415,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    )
  }

  const getVal = (key: string): string | null => {
    if (form) return form.get(key)?.toString() ?? null
    const v = jsonBody[key]
    return typeof v === "string" || typeof v === "number" ? String(v) : null
  }

  const chat_id = getVal("chat_id")

  if (!chat_id) {
    return new Response(
      JSON.stringify({ error: "chat_id is required" }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    )
  }

  try {
    // Отримуємо всі неоплачені інвойси для цього chat_id
    const { data: unpaidInvoices, error: invoicesError } = await supabase
      .from('invoices')
      .select('*')
      .eq('chat_id', chat_id)
      .eq('isPayed', false)

    if (invoicesError) {
      console.error("Error fetching invoices:", invoicesError)
      return new Response(
        JSON.stringify({ error: "Failed to fetch invoices", details: invoicesError.message }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      )
    }

    if (!unpaidInvoices || unpaidInvoices.length === 0) {
      return new Response(
        JSON.stringify({ 
          status: "ok", 
          message: "No unpaid invoices found",
          chat_id,
          invoicesCount: 0
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      )
    }

    // Збираємо всі invoice_id для запиту до криптобота
    const invoiceIds = unpaidInvoices.map(inv => inv.invoice_id).join(',')
    console.log(invoiceIds)

    // Робимо запит до криптобота для отримання статусів інвойсів
    const cryptoBotResponse = await fetch(
      `https://pay.crypt.bot/api/getInvoices?invoice_ids=${invoiceIds}`,
      {
        method: "GET",
        headers: {
          "Crypto-Pay-API-Token": CRYPTO_BOT_API_TOKEN
        },
      }
    )

    if (!cryptoBotResponse.ok) {
      console.error("Crypto bot API error:", cryptoBotResponse.status, cryptoBotResponse.statusText)
      return new Response(
        JSON.stringify({ error: "Failed to fetch invoice statuses from crypto bot" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      )
    }

    const cryptoBotData = await cryptoBotResponse.json()
    console.log("Crypto bot API response:", JSON.stringify(cryptoBotData, null, 2))
    
    if (!cryptoBotData.ok || !cryptoBotData.result) {
      console.error("Crypto bot API returned error:", cryptoBotData)
      return new Response(
        JSON.stringify({ error: "Crypto bot API error", details: cryptoBotData }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      )
    }

    // Переконуємося, що result є масивом
    let cryptoBotInvoices: any[] = []
    if (Array.isArray(cryptoBotData.result)) {
      cryptoBotInvoices = cryptoBotData.result
    } else if (typeof cryptoBotData.result === 'object' && cryptoBotData.result !== null) {
      // Якщо result - об'єкт, конвертуємо його значення в масив
      cryptoBotInvoices = Object.values(cryptoBotData.result)
    } else {
      console.error("Unexpected result format:", typeof cryptoBotData.result, cryptoBotData.result)
      return new Response(
        JSON.stringify({ error: "Unexpected API response format", details: cryptoBotData }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      )
    }

    const processedInvoices = []

    // Перевіряємо кожен інвойс
    for (const invoice of unpaidInvoices) {
      const cryptoBotInvoice = cryptoBotInvoices.find(
        (cbi: any) => cbi.invoice_id === invoice.invoice_id || cbi.invoice_id?.toString() === invoice.invoice_id?.toString()
      )

      if (!cryptoBotInvoice) {
        console.log(`Invoice ${invoice.invoice_id} not found in crypto bot response`)
        continue
      }

      // Перевіряємо, чи інвойс оплачений в криптоботі, але не оплачений в Supabase
      if (cryptoBotInvoice.status === 'paid' && !invoice.isPayed) {
        try {
          // Використовуємо атомарну транзакцію для оновлення балансу та інвойсу
          const { data: atomicResult, error: atomicError } = await supabase.functions.invoke('atomic-transactions', {
            body: {
              operation: 'update_invoice_balance',
              chat_id: chat_id,
              invoice_id: invoice.invoice_id,
              amount: invoice.amount,
              currency: invoice.currency
            }
          })

          if (atomicError || !atomicResult?.success) {
            console.error(`Error in atomic transaction for invoice ${invoice.invoice_id}:`, atomicError || atomicResult?.error)
            continue
          }

          processedInvoices.push({
            invoice_id: invoice.invoice_id,
            amount: invoice.amount,
            currency: invoice.currency,
            status: 'updated'
          })

          console.log(`Updated invoice ${invoice.invoice_id} for chat_id ${chat_id}, added ${invoice.amount} ${invoice.currency}`)
        } catch (err) {
          console.error(`Error processing invoice ${invoice.invoice_id}:`, err)
        }
      }
    }

    return new Response(
      JSON.stringify({
        status: "ok",
        chat_id,
        totalUnpaidInvoices: unpaidInvoices.length,
        processedInvoices: processedInvoices.length,
        invoices: processedInvoices
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    )
  } catch (error) {
    console.error("Unexpected error:", error)
    return new Response(
      JSON.stringify({ error: "Internal server error", details: error instanceof Error ? error.message : String(error) }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    )
  }
})

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/crypto-bot-webhook' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
    --header 'Content-Type: application/json' \
    --data '{"name":"Functions"}'

*/
