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

const icoURL = "https://srvocgygtpgzelmmdola.supabase.co/storage/v1/object/sign/payments/ico.jpg?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV8yMmI3MWRlMy1mNGZhLTRiYTAtOGFlOC0xOTlhNmRiYTIyOGUiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJwYXltZW50cy9pY28uanBnIiwiaWF0IjoxNzY1MjM3ODQyLCJleHAiOjE3OTY3NzM4NDJ9.sTcLEW_3nFyuWqglOIK_83zh2IuSnU5c2DjFVsT9a-Y"
const tradingURL = "https://srvocgygtpgzelmmdola.supabase.co/storage/v1/object/sign/payments/trading.jpg?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV8yMmI3MWRlMy1mNGZhLTRiYTAtOGFlOC0xOTlhNmRiYTIyOGUiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJwYXltZW50cy90cmFkaW5nLmpwZyIsImlhdCI6MTc2NTIzNzg4NywiZXhwIjoxNzk2NzczODg3fQ.Npmq4lBOPBTPXXJrp13x2YPIsuoz8WLZPOkMaAGu2TQ"

// CORS headers helper
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

Deno.serve(async (req: Request) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const contentType = req.headers.get("content-type") || "";

  let type: string | null = null;
  let money_type: string | null = null;
  let chat_id_str: string | null = null;
  let amount: string | null = null;
  let currency: string | null = null;
  let ref_id: string | null = null;
  let message_text: string | null = null;
  let smm: string | null = null;
  let closer: string | null = null;
  let job: string | null = null;
  let smm_amount: string | null = null;
  let closer_amount: string | null = null;
  let platform: string | null = null;

  if (contentType.includes("multipart/form-data")) {
    // 🔹 Випадок, коли ти шлеш через curl з --form
    const form = await req.formData();
    type = form.get("type")?.toString() ?? null;
    chat_id_str = form.get("chat_id")?.toString() ?? null;
    amount = form.get("amount")?.toString() ?? null;
    currency = form.get("currency")?.toString() ?? null;
    message_text = form.get("message")?.toString() ?? null;
    smm = form.get("smm")?.toString() ?? null;
    closer = form.get("closer")?.toString() ?? null;
    job = form.get("job")?.toString() ?? null;
    smm_amount = form.get("smm_amount")?.toString() ?? null;
    closer_amount = form.get("closer_amount")?.toString() ?? null;
    platform = form.get("platform")?.toString() ?? form.get("площадка")?.toString() ?? null;
    money_type = form.get("money_type")?.toString() ?? null;
  } else if (contentType.includes("application/json")) {
    // 🔹 Випадок, коли шлеться JSON (Telegram webhook, fetch, axios і т.д.)
    const body = await req.json();
    type = body.type ?? null;
    chat_id_str = body.chat_id ? String(body.chat_id) : null;
    amount = body.amount ? String(body.amount) : null;
    currency = body.currency ?? null;
    ref_id = body.ref_id ?? null;
    message_text = body.message ?? null;
    smm = body.smm ?? null;
    closer = body.closer ?? null;
    job = body.job ?? null;
    smm_amount = body.smm_amount ?? null;
    closer_amount = body.closer_amount ?? null;
    platform = body.platform ?? body.площадка ?? null;
    money_type = body.money_type ?? null;
  } else if (contentType.includes("application/x-www-form-urlencoded")) {
    const text = await req.text();
    const params = new URLSearchParams(text);
    type = params.get("type");
    chat_id_str = params.get("chat_id");
    amount = params.get("amount");
    currency = params.get("currency");
    ref_id = params.get("ref_id");
    message_text = params.get("message");
    smm = params.get("smm");
    closer = params.get("closer");
    job = params.get("job");
    smm_amount = params.get("smm_amount");
    closer_amount = params.get("closer_amount");
    platform = params.get("platform") || params.get("площадка");
    money_type = params.get("money_type") ?? null;
  } else {
    return new Response(
      JSON.stringify({
        error: `Unsupported Content-Type: ${contentType}`,
      }),
      { 
        headers: { ...corsHeaders, "Content-Type": "application/json" }, 
        status: 400 
      },
    );
  }

  // Перевірка обов'язкових полів
  // Для типу payment chat_id не потрібен
  if (!type) {
    return new Response(
      JSON.stringify({ error: "Missing required field: type is required" }),
      { 
        headers: { ...corsHeaders, "Content-Type": "application/json" }, 
        status: 400 
      }
    );
  }

  // Для типів, крім payment, chat_id обов'язковий
  if (type !== 'payment' && !chat_id_str) {
    return new Response(
      JSON.stringify({ error: "Missing required field: chat_id is required for this type" }),
      { 
        headers: { ...corsHeaders, "Content-Type": "application/json" }, 
        status: 400 
      }
    );
  }

  // Конвертуємо chat_id в число (якщо він є)
  let chat_id: number | null = null;
  if (chat_id_str) {
    chat_id = parseInt(chat_id_str);
    if (isNaN(chat_id)) {
      return new Response(
        JSON.stringify({ error: "Invalid chat_id: must be a number" }),
        { 
          headers: { ...corsHeaders, "Content-Type": "application/json" }, 
          status: 400 
        }
      );
    }
  }

  console.log({ type, chat_id });

  // Отримуємо користувача (тільки якщо chat_id є, для payment не потрібно)
  let user = null;
  if (chat_id) {
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('chat_id', chat_id)
      .single();

    if (userError && type !== 'payment') {
      console.error('Error fetching user:', userError);
      return new Response(
        JSON.stringify({ error: userError.message }),
        { 
          headers: { ...corsHeaders, "Content-Type": "application/json" }, 
          status: 500 
        }
      );
    }
    user = userData;
  }

  // Обробка різних типів
  if (type === 'deposit') {
    // Перевірка обов'язкових полів для deposit
    if (!amount || !currency) {
      return new Response(
        JSON.stringify({ error: "For type 'deposit', amount and currency are required" }),
        { 
          headers: { ...corsHeaders, "Content-Type": "application/json" }, 
          status: 400 
        }
      );
    }

    console.log({ type, chat_id, amount, currency });

    // Ваша логіка для deposit тут
    // Наприклад, оновлення балансу користувача:
    // const column = currency === 'rub' ? 'rub_amount' : 'usdt_amount';
    // const { error } = await supabase
    //   .from('users')
    //   .update({ [column]: parseFloat(user[column]) + parseFloat(amount as string) })
    //   .eq('chat_id', chat_id);

    // Відправка повідомлення через bot2
    const botToken2 = Deno.env.get("BOT_TOKEN");
    if (botToken2) {
      try {
        const bot2 = new Bot(botToken2);
        await bot2.api.sendMessage(chat_id, `Ваш баланс пополнен на ${amount} ${String(currency).toUpperCase()}`);
      } catch (error) {
        console.error('Error sending message:', error);
      }
    } else {
      console.error('BOT_TOKEN2 is not set');
    }

    return new Response(
      JSON.stringify({ 
        success: true,
        type: 'deposit',
        chat_id,
        amount,
        currency
      }),
      { 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );
  }

  if (type === 'withdrawal_return') {
    // Перевірка обов'язкових полів для withdrawal_return
    if (!amount || !currency) {
      return new Response(
        JSON.stringify({ error: "For type 'withdrawal_return', amount and currency are required" }),
        { 
          headers: { ...corsHeaders, "Content-Type": "application/json" }, 
          status: 400 
        }
      );
    }

    console.log({ type, chat_id, amount, currency });

    // Відправка повідомлення через bot2
    const botToken2 = Deno.env.get("BOT_TOKEN");
    if (botToken2) {
      try {
        const bot2 = new Bot(botToken2);
        await bot2.api.sendMessage(chat_id, `Ваша транзакция была отменена\nСумма: ${amount} ${String(currency).toUpperCase()}`);
      } catch (error) {
        console.error('Error sending message:', error);
      }
    } else {
      console.error('BOT_TOKEN2 is not set');
    }

    return new Response(
      JSON.stringify({ 
        success: true,
        type: 'withdrawal_return',
        chat_id,
        amount,
        currency
      }),
      { 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );
  }

  if (type === 'send_message') {
    // Перевірка обов'язкових полів для send_message
    if (!message_text) {
      return new Response(
        JSON.stringify({ error: "For type 'send_message', message is required" }),
        { 
          headers: { ...corsHeaders, "Content-Type": "application/json" }, 
          status: 400 
        }
      );
    }

    console.log({ type, chat_id, message_text });

    // Відправка повідомлення через bot2
    const botToken2 = Deno.env.get("BOT_TOKEN");
    if (botToken2) {
      try {
        const bot2 = new Bot(botToken2);
        await bot2.api.sendMessage(chat_id, message_text);
        
        // Збереження повідомлення в таблицю messages
        // from - відправник (ref_id або user.ref_id), to - одержувач (chat_id)
        const senderId = ref_id || user?.ref_id || 'bot';
        const { error: messageError } = await supabase
          .from('messages')
          .insert({
            from: String(senderId),
            to: String(chat_id),
            message: message_text
          });
        
        if (messageError) {
          console.error('Error saving message to database:', messageError);
        }
      } catch (error) {
        console.error('Error sending message:', error);
      }
    } else {
      console.error('BOT_TOKEN is not set');
    }

    return new Response(
      JSON.stringify({ 
        success: true,
        type: 'send_message',
        chat_id,
        message: message_text
      }),
      { 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );
  }

  if (type === 'new_employee') {
    // Перевірка обов'язкових полів для employee_message
    if (!message_text) {
      return new Response(
        JSON.stringify({ error: "For type 'employee_message', message is required" }),
        { 
          headers: { ...corsHeaders, "Content-Type": "application/json" }, 
          status: 400 
        }
      );
    }

    console.log({ type, chat_id, message_text });

    // Відправка повідомлення через new-employee бота
    const newEmployeeBotToken = Deno.env.get("NEW_EMPLOYEE_BOT_TOKEN");
    if (newEmployeeBotToken) {
      try {
        const newEmployeeBot = new Bot(newEmployeeBotToken);
        await newEmployeeBot.api.sendMessage(chat_id, message_text);
        
        // Збереження повідомлення в таблицю new-employee-messages
        // from - відправник (ref_id або user.ref_id або 'bot'), to - одержувач (chat_id)
        const senderId = ref_id || user?.ref_id || 'bot';
        const { error: messageError, data: newEmployeeData } = await supabase
          .from('new-employee-messages')
          .insert({
            chat_id: chat_id,
            to: String(chat_id),
            message: message_text,
            from: "bot",
          });
        
        if (messageError) {
          console.error('Error saving message to new-employee table:', messageError);
        }

        return new Response(
          JSON.stringify(newEmployeeData),
          { 
            headers: { ...corsHeaders, "Content-Type": "application/json" } 
          }
        );
      } catch (error) {
        console.error('Error sending message to new-employee bot:', error);
        return new Response(
          JSON.stringify({ error: 'Error sending message to new-employee bot' }),
          { 
            headers: { ...corsHeaders, "Content-Type": "application/json" }, 
            status: 500 
          }
        );
      }
    } else {
      console.error('NEW_EMPLOYEE_BOT_TOKEN is not set');
      return new Response(
        JSON.stringify({ error: 'NEW_EMPLOYEE_BOT_TOKEN is not configured' }),
        { 
          headers: { ...corsHeaders, "Content-Type": "application/json" }, 
          status: 500 
        }
      );
    }

   
  }

  if (type === 'payment') {
    // Перевірка обов'язкових полів для payment
    if (!smm || !amount || !closer || !job) {
      return new Response(
        JSON.stringify({ error: "For type 'payment', smm, amount, closer, and job are required" }),
        { 
          headers: { ...corsHeaders, "Content-Type": "application/json" }, 
          status: 400 
        }
      );
    }

    // Розрахунок сум: smm_amount = 30% від amount, closer_amount = 30% від amount
    // amount, smm_amount, closer_amount - текстові типи
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum)) {
      return new Response(
        JSON.stringify({ error: "Invalid amount: must be a valid number" }),
        { 
          headers: { ...corsHeaders, "Content-Type": "application/json" }, 
          status: 400 
        }
      );
    }
    
    const calculatedSmmAmount = (amountNum * 0.3).toFixed(2);
    const calculatedCloserAmount = (amountNum * 0.3).toFixed(2);
    
    // Використовуємо передані значення, якщо вони є, інакше розраховані
    // Всі значення зберігаються як текст
    const finalSmmAmount = smm_amount || calculatedSmmAmount;
    const finalCloserAmount = closer_amount || calculatedCloserAmount;

    console.log({ type, smm, amount, closer, job, platform, smm_amount: finalSmmAmount, closer_amount: finalCloserAmount });

    // Збереження платежу в таблицю payments
    try {
      const { error: paymentError } = await supabase
        .from('payments')
        .insert({
          smm: smm,
          amount: amount,
          closer: closer,
          job: job,
          platform: platform,
          smm_amount: finalSmmAmount,
          closer_amount: finalCloserAmount,
          type: money_type,
          created_at: new Date().toISOString()
        });

      if (paymentError) {
        console.error('Error saving payment to database:', paymentError);
        return new Response(
          JSON.stringify({ error: 'Error saving payment to database' }),
          { 
            headers: { ...corsHeaders, "Content-Type": "application/json" }, 
            status: 500 
          }
        );
      }

      // Відправка повідомлення через payment-bot всім користувачам
      const paymentBotToken = Deno.env.get("payment-bot");
      if (paymentBotToken) {
        try {
          const paymentBot = new Bot(paymentBotToken);
          const paymentMessage = `Успешный профит 🧾\n\nСумма: ${amount}$\n\nСмм: #${smm}\n\nЗаработок: ${finalSmmAmount}$ (30%)\n\nКлоузер: #${closer}\n\nЗаработок: ${finalCloserAmount}$ (30%)\n\nТема: ${money_type}🕯\n\nЛид с площадки: ${platform || 'Не указано'}\n\nПрофессия лида: ${job}`;
          
          // Отримуємо всіх користувачів з таблиці users
          const { data: users, error: usersError } = await supabase
            .from('users-payments')
            .select('chat_id')
            .not('chat_id', 'is', null);
          
          if (usersError) {
            console.error('Error fetching users:', usersError);
          } else if (users && users.length > 0) {
            // Визначаємо URL фото залежно від money_type
            let photoURL: string | null = null;
            if (money_type === 'trading') {
              photoURL = tradingURL;
            } else if (money_type === 'ico') {
              photoURL = icoURL;
            }
            
            // Відправляємо повідомлення кожному користувачу
            for (const user of users) {
              if (user.chat_id) {
                try {
                  if (photoURL) {
                    // Відправляємо фото з підписом
                    await paymentBot.api.sendPhoto(user.chat_id, photoURL, {
                      caption: paymentMessage
                    });
                  } else {
                    // Відправляємо звичайне текстове повідомлення
                    await paymentBot.api.sendMessage(user.chat_id, paymentMessage);
                  }
                } catch (error) {
                  console.error(`Error sending message to user ${user.chat_id}:`, error);
                  // Продовжуємо відправку іншим користувачам навіть якщо один не вдався
                }
              }
            }
          }
        } catch (error) {
          console.error('Error sending message to payment bot:', error);
        }
      } else {
        console.error('PAYMENT_BOT_TOKEN is not set');
      }
    } catch (error) {
      console.error('Error processing payment:', error);
      return new Response(
        JSON.stringify({ error: 'Error processing payment' }),
        { 
          headers: { ...corsHeaders, "Content-Type": "application/json" }, 
          status: 500 
        }
      );
    }

    return new Response(
      JSON.stringify({ 
        success: true,
        type: 'payment',
        smm,
        amount,
        closer,
        job,
        platform,
        smm_amount: finalSmmAmount,
        closer_amount: finalCloserAmount
      }),
      { 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );
  }

  // Обробка інших типів
  // Відправка повідомлення через bot2
  const botToken2 = Deno.env.get("BOT_TOKEN");
  if (botToken2) {
    try {
      console.log('Sending message to bot2:', `Type: ${type}, chat_id: ${chat_id}`);
      const bot2 = new Bot(botToken2);
      const messageText = `Здравствуйте, меня зовут Владимир!

Для дальнейшей работы с нашим сервисом, предоставьте свои данные в формате:

• Ваш ФИО
• Город проживания
• Ваш возраст`;
      await bot2.api.sendMessage(chat_id, messageText);
      
      // Збереження повідомлення в таблицю messages
      // from - відправник (ref_id або user.ref_id), to - одержувач (chat_id)
      const senderId = ref_id || user?.ref_id || 'bot';
      const { error: messageError } = await supabase
        .from('messages')
        .insert({
          from: String(senderId),
          to: String(chat_id),
          message: messageText
        });
      
      if (messageError) {
        console.error('Error saving message to database:', messageError);
      }
      
    } catch (error) {
      console.error('Error sending message:', error);
    }
  } else {
    console.error('BOT_TOKEN2 is not set');
  }

  return new Response(
    JSON.stringify({ 
      success: true,
      type,
      chat_id
    }),
    { 
      headers: { ...corsHeaders, "Content-Type": "application/json" } 
    }
  );
})
