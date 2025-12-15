import { serve } from "https://deno.land/std@0.131.0/http/server.ts";
import { Bot, webhookCallback, InlineKeyboard, Keyboard } from "https://deno.land/x/grammy@v1.8.3/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

console.log(`Function "telegram-bot" up and running!`);

const supabaseUrl = Deno.env.get("URL") || "";
const supabaseKey = Deno.env.get("KEY") || "";
const supabase = createClient(supabaseUrl, supabaseKey);

const bot = new Bot(Deno.env.get("BOT_TOKEN") || "");

bot.command("start", async (ctx) => {

  const startMessage = ctx.message.text;
  const refID = startMessage.split(' ')[1];
  const chat_id = ctx.message.chat.id;

  console.log('chat_id:', chat_id);
  console.log('refID:', refID);
  console.log(JSON.stringify(ctx.message));


  const { data: user, error } = await supabase
    .from('users')
    .select('*')
    .eq('chat_id', chat_id)
    .single();

    if (error) {
      if (error.code === 'PGRST116') {
        const { error: insertError } = await supabase
          .from('users')
          .insert({ chat_id, ref_id: refID, username: ctx.message.chat.username, first_name: ctx.message?.chat?.first_name || '' });
  
        if (insertError) {
          console.error(insertError);
          return;
        }
      } else {
        console.error(error);
        return;
      }
    }
  
    const keyboard = new Keyboard().webApp(
      "Торговля",
      `https://web-app-kappa-one.vercel.app/?chat_id=${chat_id}`
    );

    const {data: refUser, error: refUserError} = await supabase.from('users').select('*').eq('chat_id', chat_id).single();

    if(refUser.spam) {
      await ctx.reply(
        "Нажмите кнопку ниже, чтобы открыть торговый интерфейс:",
        {
          reply_markup: keyboard,
        }
      );
  
      const { error: updateError } = await supabase
      .from('users')
      .update({ spam: false })
      .eq('chat_id', chat_id);
  
    if (updateError) {
      console.error(updateError);
      return;
    }
    }
    
  
  }
);


// const { data: subscription, error: subscriptionError } = await supabase
//   .channel('invoices')
//   .subscribe();

// if (subscriptionError) {
//   console.error('Subscription error:', subscriptionError);
// 


const handleUpdate = webhookCallback(bot, "std/http");

serve(async (req) => {
  try {
    await handleUpdate(req);
  } catch (err) {
    console.error(err);
  }
});
