import { serve } from "https://deno.land/std@0.131.0/http/server.ts";
import { Bot, webhookCallback, Keyboard } from "https://deno.land/x/grammy@v1.8.3/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

console.log(`Function "new-employee" up and running!`);
const supabaseUrl = Deno.env.get("URL") || "";
const supabaseKey = Deno.env.get("KEY") || "";
const supabase = createClient(supabaseUrl, supabaseKey);
const bot = new Bot(Deno.env.get("NEW_EMPLOYEE_BOT_TOKEN") || "");

// Команда /start
bot.command("start", async (ctx) => {
  const chat_id = ctx.message.chat.id;
  const keyboard = new Keyboard().text('Далее').row();
  const welcomeMessage = "Добро пожаловать!";
  await ctx.reply(welcomeMessage, {
    reply_markup: keyboard
  });
  
  try {
    // Перевіряємо, чи вже є заявка для цього chat_id
    const { data: existingApplication } = await supabase
      .from('new-employee')
      .select('id')
      .eq('chat_id', chat_id)
      .single();

    // Якщо заявки немає, створюємо нову
    if (!existingApplication) {
      const { error: insertError } = await supabase
        .from('new-employee')
        .insert({
          chat_id: chat_id,
          username: ctx.message.chat.username,
          first_name: ctx.message.chat.first_name,
          isDone: false
        });
      
      if (insertError) {
        console.error('Error creating new employee application:', insertError);
      }
    }

    // Зберігаємо повідомлення в new-employee-messages
    const { data: insertedData, error: messageError } = await supabase
      .from('new-employee-messages')
      .insert({
        chat_id: chat_id,
        from: 'bot',
        to: String(chat_id),
        message: welcomeMessage,
        step: 'waiting'
      })
      .select();
    
    if (messageError) {
      console.error('Error saving welcome message:', messageError);
      console.error('Error details:', JSON.stringify(messageError, null, 2));
    } else {
      console.log('Welcome message saved successfully:', insertedData);
    }
  } catch (error) {
    console.error('Error in /start command:', error);
  }
});

// Обробка текстових повідомлень
bot.on("message:text", async (ctx) => {
  const message = ctx.message.text;
  const chat_id = ctx.message.chat.id;
  
  // Обробка кнопки "Далее"
  if (message === 'Далее') {
    // Відправка першого повідомлення з питаннями та видаленням кнопки
    const firstMessage = `1. Сколько тебе лет?

2. Ты учишься или работаешь?

3. Сколько времени готов уделять работе?

4. Был ли у тебя опыт в подобной сфере?

5. Какой результат ты хочешь получить и осознаешь ли ты что твой заработок прямо пропорционален потраченному времени?

6. Укажите свою @username телеграмм.

7. Как вы узнали про нас ?`;

    await ctx.reply(firstMessage, {
      reply_markup: { remove_keyboard: true }
    });
    
    // Зберігаємо повідомлення від бота до користувача
    try {
      const { data: insertedData, error: messageError } = await supabase
        .from('new-employee-messages')
        .insert({
          chat_id: chat_id,
          from: 'bot',
          to: String(chat_id),
          message: firstMessage,
          step: 'waiting'
        })
        .select();
      
      if (messageError) {
        console.error('Error saving bot message:', messageError);
        console.error('Error details:', JSON.stringify(messageError, null, 2));
      } else {
        console.log('Bot message saved successfully:', insertedData);
      }
    } catch (error) {
      console.error('Error in "Далее" handler:', error);
    }
    
    return;
  }

  // Обробка кнопки "Подать заявку"
  if (message === 'Подать заявку') {
    const successMessage = 'Ваша заявка успешно принята';
    
    // Відправляємо повідомлення і видаляємо кнопку
    await ctx.reply(successMessage, {
      reply_markup: { remove_keyboard: true }
    });
    
    // Зберігаємо повідомлення від бота
    try {
      const { data: insertedData, error: messageError } = await supabase
        .from('new-employee-messages')
        .insert({
          chat_id: chat_id,
          from: 'bot',
          to: String(chat_id),
          message: successMessage,
          step: 'waiting'
        })
        .select();
      
      if (messageError) {
        console.error('Error saving success message:', messageError);
        console.error('Error details:', JSON.stringify(messageError, null, 2));
      } else {
        console.log('Success message saved successfully:', insertedData);
      }
    } catch (error) {
      console.error('Error in "Подать заявку" handler:', error);
    }
    
    return;
  }

  // Обробка відповіді користувача
  try {
    // Перевіряємо, чи вже є повідомлення з step = 'done' для цього користувача
    const { data: existingRecords, error: selectError } = await supabase
      .from('new-employee-messages')
      .select('step')
      .eq('chat_id', chat_id)
      .eq('step', 'done')
      .limit(1);

    if (selectError) {
      console.error('Error checking existing records:', selectError);
    }

    const isDone = existingRecords && existingRecords.length > 0;

    // Зберігаємо повідомлення від користувача до бота
    const { data: insertedData, error: insertError } = await supabase
      .from('new-employee-messages')
      .insert({
        chat_id: chat_id,
        from: String(chat_id),
        to: 'bot',
        message: message,
        step: isDone ? 'done' : 'waiting'
      })
      .select();

    if (insertError) {
      console.error('Error saving user message:', insertError);
      console.error('Error details:', JSON.stringify(insertError, null, 2));
    } else {
      console.log('User message saved successfully:', insertedData);
    }

    // Якщо step ще не 'done', встановлюємо його в 'done' після першої відповіді
    if (!isDone) {
      // Оновлюємо всі повідомлення для цього користувача, встановлюючи step = 'done'
      const { error: updateError } = await supabase
        .from('new-employee-messages')
        .update({ step: 'done' })
        .eq('chat_id', chat_id)
        .eq('step', 'waiting');

      if (updateError) {
        console.error('Error updating messages step:', updateError);
      }

      // Відправка другого повідомлення після першої відповіді
      const secondMessage = `Коротко о работе:
Тематика: Фейк биржа, инвестиции и трейдинг 
Работа серая, работаем исключительно по рф 
Вы пришли на позицию чатер/воркер
Ваши обязанности: 
Набор базы лидов из дейтингов 
Фильтрация лидов 
Прогрев лидов (общение)
Передача на клоузера
Ваш заработок со всех депозитов переданного лида - 30%`;

      // Відправляємо повідомлення з кнопкою "Подать заявку"
      const applicationKeyboard = new Keyboard().text('Подать заявку').row();
      await ctx.reply(secondMessage, {
        reply_markup: applicationKeyboard
      });

      // Зберігаємо друге повідомлення від бота
      const { data: insertedSecondData, error: secondMessageError } = await supabase
        .from('new-employee-messages')
        .insert({
          chat_id: chat_id,
          from: 'bot',
          to: String(chat_id),
          message: secondMessage,
          step: 'done'
        })
        .select();

      if (secondMessageError) {
        console.error('Error saving second bot message:', secondMessageError);
        console.error('Error details:', JSON.stringify(secondMessageError, null, 2));
      } else {
        console.log('Second bot message saved successfully:', insertedSecondData);
      }
    }
  } catch (error) {
    console.error('Error processing message:', error);
    await ctx.reply('Сталася помилка. Спробуйте ще раз.');
  }
});

const handleUpdate = webhookCallback(bot, "std/http");
serve(async (req) => {
  try {
    return await handleUpdate(req);
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
