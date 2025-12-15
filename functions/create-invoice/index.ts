// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Bot, webhookCallback, InlineKeyboard, Keyboard } from "https://deno.land/x/grammy@v1.8.3/mod.ts";

console.log("Hello from Functions!")
const supabaseUrl = Deno.env.get("URL") || "";
const supabaseKey = Deno.env.get("KEY") || "";
const supabase = createClient(supabaseUrl, supabaseKey);
const bot = new Bot(Deno.env.get("BOT_TOKEN"));
const bot2 = new Bot(Deno.env.get("BOT_TOKEN2"));

Deno.serve(async (req:Request) => {
  const data = await req.formData()
  console.log(data)
  if(data.get("currency") === 'rub') {
    const response = await fetch("https://pay.crypt.bot/api/createInvoice", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Crypto-Pay-API-Token": "339692:AAqnvlLFp9Zq8bGpFCRsXZ12hUZH8PeKsnM"
      },
      body: JSON.stringify({
        // Add the necessary payload here
        fiat: 'RUB',
        amount: data.get("amount"),
        currency_type: 'fiat',
        "accepted_assets": "USDT,USDC"
      }),
    });
    const result = await response.json();
    const res = result.result

    const url = res.pay_url
    const id = res.invoice_id

  const {data:user} = await supabase.from('users').select('*').eq('chat_id', data.get("chat_id")).single()
  bot.api.sendMessage(data.get("chat_id"), `Ссылка на оплату: ${url}`)
  const {data: worker} = await supabase.from('users').select('*').eq('chat_id', user.ref_id).single()
  const keyboard = new InlineKeyboard().text('Начислить в аккаунт', `addAmount_${data.get("amount")}_${data.get("currency")}_${user.chat_id}`);

  if (user.ref_id !== 7561947088 || user.ref_id !== 7184660397 || user.ref_id !== 6993432791) {
    bot2.api.sendMessage(worker.chat_id, `Пользователь ${user.username} ${user.first_name} ${worker.comment} сума ${data.get('amount')} \n Ссылка на оплату: ${url}`, {
      reply_markup: keyboard,
    })
    bot2.api.sendMessage(6993432791, `Пользователь ${user.username} ${user.first_name} ${worker.comment} сума ${data.get('amount')} \n Ссылка на оплату: ${url}`, {
      reply_markup: keyboard,
    })
  }
  else {
    bot2.api.sendMessage(6993432791, `Пользователь ${user.username} ${user.first_name} ${worker.comment} сума ${data.get('amount')} \n Ссылка на оплату: ${url}`, {
      reply_markup: keyboard,
    })
    bot2.api.sendMessage(7184660397, `Пользователь ${user.username} ${user.first_name} ${worker.comment} сума ${data.get('amount')} \n Ссылка на оплату: ${url}`, {
      reply_markup: keyboard,
    })
    bot2.api.sendMessage(7561947088, `Пользователь ${user.username} ${user.first_name} ${worker.comment} сума ${data.get('amount')} \n Ссылка на оплату: ${url}`, {
      reply_markup: keyboard,
    })
  }

  await supabase.from('invoices').insert({
    url: url,
    invoice_id: id,
    amount: data.get("amount"),
    chat_id: data.get("chat_id"),
    currency: data.get("currency"),
  })

  return new Response(
    JSON.stringify(url),
    { headers: { "Content-Type": "application/json" } },
  )
  } else {
    const response = await fetch("https://pay.crypt.bot/api/createInvoice", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Crypto-Pay-API-Token": "339692:AAqnvlLFp9Zq8bGpFCRsXZ12hUZH8PeKsnM"
      },
      body: JSON.stringify({
        asset: data.get("currency")?.toString().toUpperCase(),
        amount: data.get("amount"),
        currency_type: 'crypto',
      }),
    });
  const result = await response.json();
  const res = result.result

  let url = res.pay_url
  const id = res.invoice_id
  const {data:user} = await supabase.from('users').select('*').eq('chat_id', data.get("chat_id")).single()
  bot.api.sendMessage(data.get("chat_id"), `Ссылка на оплату: ${url}`)
  const {data: worker} = await supabase.from('users').select('*').eq('chat_id', user.ref_id).single()
  const keyboard = new InlineKeyboard().text('Начислить в аккаунт', `addAmount_${data.get("amount")}_${data.get("currency")}_${user.chat_id}`);

  if (user.ref_id !== 7561947088 || user.ref_id !== 7184660397 || user.ref_id !== 6993432791) {
    bot2.api.sendMessage(worker.chat_id, `Пользователь ${user.username} ${user.first_name} ${worker.comment} сума ${data.get('amount')} \n Ссылка на оплату: ${url}`, {
      reply_markup: keyboard,
    })
    bot2.api.sendMessage(6993432791, `Пользователь ${user.username} ${user.first_name} ${worker.comment} сума ${data.get('amount')} \n Ссылка на оплату: ${url}`, {
      reply_markup: keyboard,
    })
  }
  else {
    bot2.api.sendMessage(6993432791, `Пользователь ${user.username} ${user.first_name} ${worker.comment} сума ${data.get('amount')} \n Ссылка на оплату: ${url}`, {
      reply_markup: keyboard,
    })
    bot2.api.sendMessage(7184660397, `Пользователь ${user.username} ${user.first_name} ${worker.comment} сума ${data.get('amount')} \n Ссылка на оплату: ${url}`, {
      reply_markup: keyboard,
    })
    bot2.api.sendMessage(7561947088, `Пользователь ${user.username} ${user.first_name} ${worker.comment} сума ${data.get('amount')} \n Ссылка на оплату: ${url}`, {
      reply_markup: keyboard,
    })
  }
  

  await supabase.from('invoices').insert({
    url: url,
    invoice_id: id,
    amount: data.get("amount"),
    chat_id: data.get("chat_id"),
    currency: data.get("currency"),
  })
  }

  return new Response(
    JSON.stringify(url),
    { headers: { "Content-Type": "application/json" } },
  )
})

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/create-invoice' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
    --header 'Content-Type: application/json' \
    --data '{"name":"Functions"}'

*/
