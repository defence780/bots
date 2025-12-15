import { serve } from "https://deno.land/std@0.131.0/http/server.ts";
import { Bot, webhookCallback, InlineKeyboard, Keyboard } from "https://deno.land/x/grammy@v1.8.3/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

console.log(`Function "closer-worker-analytics" up and running!`);
const supabaseUrl = Deno.env.get("URL") || "";
const supabaseKey = Deno.env.get("KEY") || "";
console.log('Supabase URL:', supabaseUrl ? 'Set' : 'NOT SET');
console.log('Supabase Key:', supabaseKey ? 'Set' : 'NOT SET');
const supabase = createClient(supabaseUrl, supabaseKey);
const bot = new Bot(Deno.env.get("statistic-bot") || "");

// Функції для роботи зі станом очікування (зберігається в БД)
async function setAwaitingAction(chatId: number, action: 'report' | 'lead' | 'closer_report' | null, step?: string, formData?: any): Promise<void> {
  const updateData: any = { awaiting_action: action };
  if (step) {
    updateData.form_step = step;
  }
  if (formData) {
    updateData.form_data = JSON.stringify(formData);
  }
  
  const { error } = await supabase
    .from('analytics-users')
    .update(updateData)
    .eq('chat_id', chatId);
  
  if (error) {
    console.error('[STATE] Error setting awaiting_action:', error);
  } else {
    console.log('[STATE] Set awaiting_action for chat_id:', chatId, 'action:', action, 'step:', step);
  }
}

async function getAwaitingAction(chatId: number): Promise<'report' | 'lead' | 'closer_report' | null> {
  const { data, error } = await supabase
    .from('analytics-users')
    .select('awaiting_action')
    .eq('chat_id', chatId)
    .single();
  
  if (error) {
    console.error('[STATE] Error getting awaiting_action:', error);
    return null;
  }
  
  return (data?.awaiting_action as 'report' | 'lead' | 'closer_report' | null) || null;
}

async function getFormStep(chatId: number): Promise<string | null> {
  const { data, error } = await supabase
    .from('analytics-users')
    .select('form_step')
    .eq('chat_id', chatId)
    .single();
  
  if (error) {
    console.error('[STATE] Error getting form_step:', error);
    return null;
  }
  
  return data?.form_step || null;
}

async function getFormData(chatId: number): Promise<any> {
  const { data, error } = await supabase
    .from('analytics-users')
    .select('form_data')
    .eq('chat_id', chatId)
    .single();
  
  if (error) {
    console.error('[STATE] Error getting form_data:', error);
    return null;
  }
  
  if (!data?.form_data) {
    return {};
  }
  
  try {
    return JSON.parse(data.form_data);
  } catch (e) {
    console.error('[STATE] Error parsing form_data:', e);
    return {};
  }
}

async function clearFormData(chatId: number): Promise<void> {
  const { error } = await supabase
    .from('analytics-users')
    .update({ form_step: null, form_data: null })
    .eq('chat_id', chatId);
  
  if (error) {
    console.error('[STATE] Error clearing form data:', error);
  }
}

// Допоміжна функція для отримання клавіатури залежно від ролі
const getKeyboardForUser = async (chat_id: number) => {
  const { data: user, error: userError } = await supabase
    .from('analytics-users')
    .select('role, ref_id')
    .eq('chat_id', chat_id)
    .single();
  
  if (userError || !user) {
    console.error(`Error fetching user ${chat_id}:`, userError);
    // Якщо користувача не знайдено, показуємо кнопки клоузера за замовчуванням
    return new Keyboard()
      .text('🔗 Створити посилання')
      .text('👥 Мої воркери').row()
      .text('📊 Статистика по воркерам')
      .text('📈 Моя статистика').row()
      .text('📋 Звіти воркерів')
      .text('👤 Ліди від воркерів').row()
      .text('📋 Звіти за сьогодні')
      .text('👤 Звіти воркера').row()
      .text('📋 Заявки по лідам')
      .text('✅ Активні ліди').row()
      .text('❌ Неактивні ліди').row()
      .text('📝 Надіслати звіт').row()
      .text('📅 Статистика за тиждень')
      .text('📆 Статистика за місяць');
  }

  if (user?.role === 'closer') {
    // Клавіатура для клоузера
    return new Keyboard()
      .text('🔗 Створити посилання')
      .text('👥 Мої воркери').row()
      .text('📊 Статистика по воркерам')
      .text('📈 Моя статистика').row()
      .text('📋 Звіти воркерів')
      .text('👤 Ліди від воркерів').row()
      .text('📋 Звіти за сьогодні')
      .text('👤 Звіти воркера').row()
      .text('📋 Заявки по лідам')
      .text('✅ Активні ліди').row()
      .text('❌ Неактивні ліди').row()
      .text('📝 Надіслати звіт').row()
      .text('📅 Статистика за тиждень')
      .text('📆 Статистика за місяць');
  } else if (user?.role === 'worker') {
    // Клавіатура для воркера - тільки дві кнопки
    return new Keyboard()
      .text('📝 Надіслати звіт')
      .text('👤 Передати ліда');
  }
  
  // За замовчуванням (якщо роль не визначена) - показуємо кнопки клоузера
  // Але це не повинно статися, якщо користувач правильно зареєстрований
  console.warn(`User ${chat_id} has no role defined, showing closer keyboard`);
  return new Keyboard()
    .text('🔗 Створити посилання')
    .text('👥 Мої воркери').row()
    .text('📊 Статистика по воркерам')
    .text('📈 Моя статистика').row()
    .text('📋 Звіти воркерів')
    .text('👤 Ліди від воркерів').row()
    .text('📋 Звіти за сьогодні')
    .text('👤 Звіти воркера').row()
    .text('📋 Заявки по лідам')
    .text('✅ Активні ліди').row()
    .text('❌ Неактивні ліди').row()
    .text('📝 Надіслати звіт').row()
    .text('📅 Статистика за тиждень')
    .text('📆 Статистика за місяць');
};

// Команда /start - для клоузера та воркера
bot.command("start", async (ctx) => {
  const chat_id = ctx.message.chat.id;
  const username = ctx.message.chat.username || null;
  const first_name = ctx.message.chat.first_name || null;
  
  // Перевіряємо, чи є реферальний параметр в посиланні
  const startParam = ctx.message.text?.split(' ')[1];
  
  if (startParam && startParam.startsWith('closer_')) {
    // Воркер перейшов по посиланню клоузера
    const closer_chat_id = parseInt(startParam.replace('closer_', ''));
    
    if (isNaN(closer_chat_id)) {
      await ctx.reply('❌ Невірне посилання.');
      return;
    }

    // Перевіряємо, чи клоузер існує
    const { data: closer, error: closerError } = await supabase
      .from('analytics-users')
      .select('chat_id, username, first_name')
      .eq('chat_id', closer_chat_id)
      .eq('role', 'closer')
      .single();

    if (closerError || !closer) {
      await ctx.reply('❌ Клоузер не знайдений.');
      return;
    }

    // Перевіряємо, чи користувач вже існує в analytics-users
    const { data: existingUser, error: checkError } = await supabase
      .from('analytics-users')
      .select('*')
      .eq('chat_id', chat_id)
      .single();

    if (existingUser) {
      // Якщо воркер вже прив'язаний до іншого клоузера
      if (existingUser.ref_id && existingUser.ref_id !== closer_chat_id) {
        await ctx.reply(`⚠️ Ви вже прив'язані до іншого клоузера.\n\nВаш поточний клоузер: @${closer.username || 'Unknown'}`);
        return;
      }

      // Оновлюємо ref_id та роль (якщо користувач був клоузером, стає воркером)
      const { error: updateError } = await supabase
        .from('analytics-users')
        .update({
          ref_id: closer_chat_id,
          role: 'worker', // Встановлюємо роль воркера
          username: username,
          first_name: first_name,
          updated_at: new Date().toISOString()
        })
        .eq('chat_id', chat_id);

      if (updateError) {
        await ctx.reply('❌ Помилка при прив\'язці до клоузера.');
        return;
      }

      await ctx.reply(`✅ Ви успішно прив'язані до клоузера: @${closer.username || closer.first_name || 'Unknown'}`);
      
      // Відправляємо повідомлення клоузеру про оновлення прив'язки воркера
      try {
        const workerInfo = `👤 Воркер оновив прив'язку:\n\n`;
        const workerDetails = `👤 Ім'я: ${first_name || 'Не вказано'}\n`;
        const workerUsername = username ? `📱 Username: @${username}\n` : '';
        const workerChatId = `🆔 Chat ID: ${chat_id}\n`;
        const closerMessage = workerInfo + workerDetails + workerUsername + workerChatId;
        
        await bot.api.sendMessage(closer_chat_id, closerMessage);
        console.log('[START] Notification sent to closer about worker update:', closer_chat_id);
      } catch (notifyError) {
        console.error('[START] Error sending notification to closer:', notifyError);
      }
    } else {
      // Створюємо нового користувача з прив'язкою до клоузера
      const { error: insertError } = await supabase
        .from('analytics-users')
        .insert({
          chat_id: chat_id,
          username: username,
          first_name: first_name,
          ref_id: closer_chat_id,
          role: 'worker',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });

      if (insertError) {
        console.error('Error adding user to analytics-users:', insertError);
        await ctx.reply('❌ Помилка при реєстрації. Спробуйте ще раз.');
        return;
      }

      await ctx.reply(`✅ Вітаємо! Ви успішно прив'язані до клоузера: @${closer.username || closer.first_name || 'Unknown'}\n\nТепер ви можете надсилати звіти та передавати ліди.`);
      
      // Відправляємо повідомлення клоузеру про нового воркера
      try {
        const workerInfo = `🎉 Новий воркер приєднався!\n\n`;
        const workerDetails = `👤 Ім'я: ${first_name || 'Не вказано'}\n`;
        const workerUsername = username ? `📱 Username: @${username}\n` : '';
        const workerChatId = `🆔 Chat ID: ${chat_id}\n`;
        const closerMessage = workerInfo + workerDetails + workerUsername + workerChatId;
        
        await bot.api.sendMessage(closer_chat_id, closerMessage);
        console.log('[START] Notification sent to closer about new worker:', closer_chat_id);
      } catch (notifyError) {
        console.error('[START] Error sending notification to closer:', notifyError);
      }
    }

    // Показуємо меню для воркера - тільки дві кнопки
    const keyboard = await getKeyboardForUser(chat_id);
    
    await ctx.reply('Оберіть опцію:', { reply_markup: keyboard });
    return;
  }

  // Якщо це клоузер (без параметра)
  // Перевіряємо, чи користувач вже існує
  const { data: existingUser, error: checkError } = await supabase
    .from('analytics-users')
    .select('*')
    .eq('chat_id', chat_id)
    .single();

  if (!existingUser || checkError?.code === 'PGRST116') {
    // Створюємо нового користувача як клоузера
    const { error: insertError } = await supabase
      .from('analytics-users')
      .insert({
        chat_id: chat_id,
        username: username,
        first_name: first_name,
        role: 'closer',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

    if (insertError) {
      console.error('Error adding user to analytics-users:', insertError);
      await ctx.reply('❌ Помилка при реєстрації. Спробуйте ще раз.');
      return;
    }
  } else {
    // Оновлюємо дані
    await supabase
      .from('analytics-users')
      .update({
        username: username,
        first_name: first_name,
        updated_at: new Date().toISOString()
      })
      .eq('chat_id', chat_id);
  }

  // Показуємо меню для клоузера
  const keyboard = await getKeyboardForUser(chat_id);
  
  await ctx.reply('Вітаємо! Оберіть опцію:', { reply_markup: keyboard });
});

// Кнопка "Надіслати звіт" для воркера
bot.callbackQuery('send_report', async (ctx) => {
  try {
    console.log('[SEND_REPORT] Callback query received');
    await ctx.answerCallbackQuery();
    const chat_id = ctx.callbackQuery.message?.chat.id;
    console.log('[SEND_REPORT] Chat ID:', chat_id);

    if (!chat_id) {
      console.error('[SEND_REPORT] No chat_id found');
      await ctx.reply('❌ Помилка отримання chat_id.');
      return;
    }

    // Перевіряємо, чи воркер прив'язаний до клоузера
    console.log('[SEND_REPORT] Checking worker in analytics-users...');
    const { data: worker, error: workerError } = await supabase
      .from('analytics-users')
      .select('ref_id')
      .eq('chat_id', chat_id)
      .single();

    console.log('[SEND_REPORT] Worker data:', worker);
    console.log('[SEND_REPORT] Worker error:', workerError);

    if (workerError) {
      console.error('[SEND_REPORT] Error fetching worker:', workerError);
    }

    if (!worker || !worker.ref_id) {
      console.error('[SEND_REPORT] Worker not found or not bound to closer. Worker:', worker);
      await ctx.reply('❌ Ви не прив\'язані до клоузера.');
      return;
    }

    console.log('[SEND_REPORT] Worker found, closer_chat_id:', worker.ref_id);
    
    // Починаємо багатокрокову форму для звіту
    await setAwaitingAction(chat_id, 'report', 'report_date', {});
    console.log('[SEND_REPORT] Starting report form for chat_id:', chat_id);

    const keyboard = new InlineKeyboard()
      .text('❌ Скасувати', 'cancel_report');

    await ctx.reply(
      '📝 Заповніть форму звіту.\n\n' +
      '📅 Крок 1/4: Вкажіть дату та час роботи\n' +
      'Наприклад: 15.12.2024, 10:00-18:00\n' +
      'Або просто: Сьогодні',
      { reply_markup: keyboard }
    );
    console.log('[SEND_REPORT] Reply sent to worker, waiting for report form...');
  } catch (error) {
    console.error('[SEND_REPORT] Error in send_report:', error);
    console.error('[SEND_REPORT] Error stack:', error instanceof Error ? error.stack : 'No stack');
    await ctx.reply('❌ Помилка при підготовці до надсилання звіту.');
  }
});

// Кнопка "Надіслати звіт" для клоузера
bot.callbackQuery('closer_send_report', async (ctx) => {
  try {
    await ctx.answerCallbackQuery();
    const chat_id = ctx.callbackQuery.message?.chat.id;

    if (!chat_id) {
      await ctx.reply('❌ Помилка отримання chat_id.');
      return;
    }

    // Перевіряємо, чи це клоузер
    const { data: user } = await supabase
      .from('analytics-users')
      .select('role')
      .eq('chat_id', chat_id)
      .single();

    if (!user || user.role !== 'closer') {
      await ctx.reply('❌ Ця функція доступна тільки для клоузерів.');
      return;
    }

    // Встановлюємо прапорець, що очікується звіт від клоузера
    await setAwaitingAction(chat_id, 'closer_report');

    const keyboard = new InlineKeyboard()
      .text('❌ Скасувати', 'cancel_closer_report');

    await ctx.reply('📝 Надішліть ваш звіт. Можна надіслати текст, фото з підписом, документ або відео.\n\nЗвіт буде збережено в базі даних.', {
      reply_markup: keyboard
    });
  } catch (error) {
    console.error('Error in closer_send_report:', error);
    await ctx.reply('❌ Помилка при підготовці до надсилання звіту.');
  }
});

// Скасування надсилання звіту клоузера
bot.callbackQuery('cancel_closer_report', async (ctx) => {
  try {
    await ctx.answerCallbackQuery();
    const chat_id = ctx.callbackQuery.message?.chat.id;

    if (chat_id) {
      await setAwaitingAction(chat_id, null);
    }

    const keyboard = await getKeyboardForUser(chat_id || 0);

    await ctx.reply('❌ Надсилання звіту скасовано.', {
      reply_markup: keyboard
    });
  } catch (error) {
    console.error('Error canceling closer report:', error);
  }
});

// Скасування надсилання звіту (для воркера)
bot.callbackQuery('cancel_report', async (ctx) => {
  try {
    await ctx.answerCallbackQuery();
    const chat_id = ctx.callbackQuery.message?.chat.id;

    if (chat_id) {
      await clearFormData(chat_id);
    }

    const keyboard = await getKeyboardForUser(chat_id || 0);

    await ctx.reply('❌ Надсилання звіту скасовано.', {
      reply_markup: keyboard
    });
  } catch (error) {
    console.error('Error canceling report:', error);
  }
});

// Кнопка "Передати ліда" для воркера
bot.callbackQuery('send_lead', async (ctx) => {
  try {
    await ctx.answerCallbackQuery();
    const chat_id = ctx.callbackQuery.message?.chat.id;

    if (!chat_id) {
      await ctx.reply('❌ Помилка отримання chat_id.');
      return;
    }

    // Перевіряємо, чи воркер прив'язаний до клоузера
    const { data: worker } = await supabase
      .from('analytics-users')
      .select('ref_id')
      .eq('chat_id', chat_id)
      .single();

    if (!worker || !worker.ref_id) {
      await ctx.reply('❌ Ви не прив\'язані до клоузера.');
      return;
    }

    // Починаємо багатокрокову форму для ліда
    await setAwaitingAction(chat_id, 'lead', 'lead_name', {});
    console.log('[SEND_LEAD] Starting lead form for chat_id:', chat_id);

    const keyboard = new InlineKeyboard()
      .text('❌ Скасувати', 'cancel_lead');

    await ctx.reply(
      '👤 Заповніть форму ліда.\n\n' +
      '👤 Крок 1/3: Вкажіть ім\'я ліда\n' +
      'Наприклад: Іван Петров',
      { reply_markup: keyboard }
    );
  } catch (error) {
    console.error('Error in send_lead:', error);
    await ctx.reply('❌ Помилка при підготовці до передачі ліда.');
  }
});

// Скасування передачі ліда
bot.callbackQuery('cancel_lead', async (ctx) => {
  try {
    await ctx.answerCallbackQuery();
    const chat_id = ctx.callbackQuery.message?.chat.id;

    if (chat_id) {
      await clearFormData(chat_id);
    }

    const keyboard = await getKeyboardForUser(chat_id || 0);

    await ctx.reply('❌ Передача ліда скасована.', {
      reply_markup: keyboard
    });
  } catch (error) {
    console.error('Error canceling lead:', error);
  }
});

// Скасування звіту
bot.callbackQuery('cancel_report', async (ctx) => {
  try {
    await ctx.answerCallbackQuery();
    const chat_id = ctx.callbackQuery.message?.chat.id;

    if (chat_id) {
      await clearFormData(chat_id);
    }

    const keyboard = await getKeyboardForUser(chat_id || 0);

    await ctx.reply('❌ Надсилання звіту скасовано.', {
      reply_markup: keyboard
    });
  } catch (error) {
    console.error('Error canceling report:', error);
  }
});

// Обробка текстових команд від Keyboard кнопок
bot.on('message:text', async (ctx) => {
  try {
    console.log('[TEXT_HANDLER] ===== TEXT HANDLER TRIGGERED =====');
    const chat_id = ctx.message.chat.id;
    const text = ctx.message.text;

    console.log('[TEXT_HANDLER] Received text message from chat_id:', chat_id);
    console.log('[TEXT_HANDLER] Text:', text);
    console.log('[TEXT_HANDLER] Text length:', text?.length);
    // Отримуємо стан очікування з БД
    const awaitingAction = await getAwaitingAction(chat_id);
    console.log('[TEXT_HANDLER] awaitingAction from DB:', awaitingAction);

    // Перевіряємо, чи це звіт/лід (якщо очікується) - обробляємо тут
    if (awaitingAction === 'report') {
      console.log('[TEXT_HANDLER] Processing worker report form for chat_id:', chat_id);
      
      // Перевіряємо, чи це воркер
      const { data: worker, error: workerError } = await supabase
        .from('analytics-users')
        .select('ref_id, username, first_name')
        .eq('chat_id', chat_id)
        .single();

      console.log('[TEXT_HANDLER] Worker data:', worker);
      console.log('[TEXT_HANDLER] Worker error:', workerError);

      if (!worker || !worker.ref_id) {
        console.error('[TEXT_HANDLER] Worker not found or not bound to closer');
        await clearFormData(chat_id);
        await ctx.reply('❌ Ви не прив\'язані до клоузера.');
        return;
      }

      // Отримуємо поточний крок форми та дані
      const currentStep = await getFormStep(chat_id);
      const formData = await getFormData(chat_id);
      console.log('[TEXT_HANDLER] Current step:', currentStep, 'Form data:', formData);

      if (!text || text.trim().length === 0) {
        await ctx.reply('❌ Будь ласка, введіть відповідь.');
        return;
      }

      const keyboard = new InlineKeyboard().text('❌ Скасувати', 'cancel_report');

      // Обробка кроків форми звіту
      if (currentStep === 'report_date') {
        formData.date = text.trim();
        await setAwaitingAction(chat_id, 'report', 'report_description', formData);
        await ctx.reply(
          '✅ Дата збережена!\n\n' +
          '📝 Крок 2/4: Опишіть виконану роботу\n' +
          'Детально розкажіть, що було зроблено.',
          { reply_markup: keyboard }
        );
        return;
      } else if (currentStep === 'report_description') {
        formData.description = text.trim();
        await setAwaitingAction(chat_id, 'report', 'report_results', formData);
        await ctx.reply(
          '✅ Опис збережено!\n\n' +
          '📊 Крок 3/4: Опишіть результати\n' +
          'Які результати були досягнуті?',
          { reply_markup: keyboard }
        );
        return;
      } else if (currentStep === 'report_results') {
        formData.results = text.trim();
        await setAwaitingAction(chat_id, 'report', 'report_problems', formData);
        await ctx.reply(
          '✅ Результати збережено!\n\n' +
          '⚠️ Крок 4/4: Проблеми та зауваження (необов\'язково)\n' +
          'Якщо були проблеми, опишіть їх. Якщо нічого - напишіть "Немає" або "-"',
          { reply_markup: keyboard }
        );
        return;
      } else if (currentStep === 'report_problems') {
        formData.problems = text.trim();
        
        // Формуємо фінальний текст звіту
        const reportText = 
          `📅 Дата: ${formData.date}\n\n` +
          `📝 Виконана робота:\n${formData.description}\n\n` +
          `📊 Результати:\n${formData.results}\n\n` +
          `⚠️ Проблеми та зауваження:\n${formData.problems === 'Немає' || formData.problems === '-' ? 'Відсутні' : formData.problems}`;

        const reportData: any = {
          worker_chat_id: chat_id,
          closer_chat_id: worker.ref_id,
          message_text: reportText,
          message_type: 'text',
          status: 'unread'
        };

        console.log('[TEXT_HANDLER] Attempting to save worker report:', JSON.stringify(reportData, null, 2));
      console.log('[TEXT_HANDLER] Supabase URL:', supabaseUrl ? 'Set' : 'NOT SET');
      console.log('[TEXT_HANDLER] Supabase Key:', supabaseKey ? 'Set (length: ' + supabaseKey.length + ')' : 'NOT SET');
      console.log('[TEXT_HANDLER] Supabase client:', !!supabase);
      console.log('[TEXT_HANDLER] Table name: worker_reports');

      const { data: report, error: insertError } = await supabase
        .from('worker_reports')
        .insert(reportData)
        .select()
        .single();

      console.log('[TEXT_HANDLER] ===== INSERT RESULT =====');
      console.log('[TEXT_HANDLER] Insert result - data:', report ? JSON.stringify(report, null, 2) : 'null');
      console.log('[TEXT_HANDLER] Insert result - error:', insertError ? JSON.stringify(insertError, null, 2) : 'null');
      console.log('[TEXT_HANDLER] =======================');

      if (insertError) {
        console.error('[TEXT_HANDLER] ===== ERROR SAVING REPORT =====');
        console.error('[TEXT_HANDLER] Error object:', JSON.stringify(insertError, null, 2));
        console.error('[TEXT_HANDLER] Error code:', insertError.code);
        console.error('[TEXT_HANDLER] Error message:', insertError.message);
        console.error('[TEXT_HANDLER] Error details:', insertError.details);
        console.error('[TEXT_HANDLER] Error hint:', insertError.hint);
        console.error('[TEXT_HANDLER] Full error:', insertError);
        await setAwaitingAction(chat_id, null);
        await ctx.reply(`❌ Помилка при збереженні звіту: ${insertError.message || insertError.code || 'Unknown error'}\n\nДеталі: ${JSON.stringify(insertError)}`);
        return;
      }

      if (!report) {
        console.error('[TEXT_HANDLER] ===== REPORT NOT RETURNED =====');
        console.error('[TEXT_HANDLER] Insert completed but no data returned');
        console.error('[TEXT_HANDLER] Insert result was:', { data: report, error: insertError });
        await setAwaitingAction(chat_id, null);
        await ctx.reply('❌ Помилка: звіт не було збережено (дані не повернуто).');
        return;
      }

        console.log('[TEXT_HANDLER] Worker report saved successfully. Report ID:', report.id);
        await clearFormData(chat_id);

        // Відправляємо звіт клоузеру
        try {
          const workerName = `@${worker.username || worker.first_name || 'Unknown'}`;
          const reportDate = new Date(report.created_at).toLocaleString('uk-UA');
          const closerMessage = `📋 Новий звіт від воркера ${workerName}\n📅 ${reportDate}\n\n${reportText}`;
          
          console.log('[TEXT_HANDLER] Sending text message to closer:', worker.ref_id);
          const sendResult = await bot.api.sendMessage(worker.ref_id, closerMessage);
          console.log('[TEXT_HANDLER] Text message sent successfully. Message ID:', sendResult.message_id);

          const keyboard = await getKeyboardForUser(chat_id);
          await ctx.reply('✅ Звіт успішно збережено та надіслано клоузеру!', {
            reply_markup: keyboard
          });
        } catch (sendError) {
          console.error('[TEXT_HANDLER] Error sending report to closer:', sendError);
          const keyboard = await getKeyboardForUser(chat_id);
          await ctx.reply('✅ Звіт збережено, але не вдалося відправити клоузеру. Спробуйте пізніше.', {
            reply_markup: keyboard
          });
        }
        return;
      } else {
        // Якщо крок не визначено, починаємо з першого
        await setAwaitingAction(chat_id, 'report', 'report_date', {});
        await ctx.reply(
          '📝 Заповніть форму звіту.\n\n' +
          '📅 Крок 1/4: Вкажіть дату та час роботи\n' +
          'Наприклад: 15.12.2024, 10:00-18:00\n' +
          'Або просто: Сьогодні',
          { reply_markup: keyboard }
        );
        return;
      }
    }

    // Обробка форми ліда
    if (awaitingAction === 'lead') {
      console.log('[TEXT_HANDLER] Processing lead form for chat_id:', chat_id);
      
      const { data: worker } = await supabase
        .from('analytics-users')
        .select('ref_id, username, first_name')
        .eq('chat_id', chat_id)
        .single();

      if (!worker || !worker.ref_id) {
        await clearFormData(chat_id);
        await ctx.reply('❌ Ви не прив\'язані до клоузера.');
        return;
      }

      const currentStep = await getFormStep(chat_id);
      const formData = await getFormData(chat_id);
      console.log('[TEXT_HANDLER] Current lead step:', currentStep, 'Form data:', formData);

      if (!text || text.trim().length === 0) {
        await ctx.reply('❌ Будь ласка, введіть відповідь.');
        return;
      }

      const keyboard = new InlineKeyboard().text('❌ Скасувати', 'cancel_lead');

      if (currentStep === 'lead_name') {
        formData.name = text.trim();
        await setAwaitingAction(chat_id, 'lead', 'lead_contact', formData);
        await ctx.reply(
          '✅ Ім\'я збережено!\n\n' +
          '📞 Крок 2/3: Вкажіть контакт ліда\n' +
          'Телефон, email або telegram username',
          { reply_markup: keyboard }
        );
        return;
      } else if (currentStep === 'lead_contact') {
        formData.contact = text.trim();
        await setAwaitingAction(chat_id, 'lead', 'lead_info', formData);
        await ctx.reply(
          '✅ Контакт збережено!\n\n' +
          '📝 Крок 3/3: Додаткова інформація про ліда\n' +
          'Опишіть деталі про ліда (необов\'язково, можна написати "-")',
          { reply_markup: keyboard }
        );
        return;
      } else if (currentStep === 'lead_info') {
        formData.info = text.trim();
        
        // Зберігаємо ліда в базу
        const leadData: any = {
          worker_chat_id: chat_id,
          closer_chat_id: worker.ref_id,
          lead_name: formData.name,
          lead_contact: formData.contact,
          lead_info: formData.info === '-' ? null : formData.info,
          lead_status: 'new'
        };

        console.log('[TEXT_HANDLER] Attempting to save lead:', JSON.stringify(leadData, null, 2));

        const { data: lead, error: insertError } = await supabase
          .from('worker_leads')
          .insert(leadData)
          .select()
          .single();

        if (insertError) {
          console.error('[TEXT_HANDLER] Error saving lead:', insertError);
          await clearFormData(chat_id);
          await ctx.reply(`❌ Помилка при збереженні ліда: ${insertError.message || 'Unknown error'}`);
          return;
        }

        console.log('[TEXT_HANDLER] Lead saved successfully. Lead ID:', lead.id);
        await clearFormData(chat_id);

        // Відправляємо ліда клоузеру
        try {
          const workerName = `@${worker.username || worker.first_name || 'Unknown'}`;
          const leadDate = new Date(lead.created_at).toLocaleString('uk-UA');
          const leadInfo = lead.lead_info || 'Відсутня';
          const closerMessage = 
            `👤 Новий лід від воркера ${workerName}\n` +
            `📅 ${leadDate}\n\n` +
            `👤 Ім'я: ${lead.lead_name}\n` +
            `📞 Контакт: ${lead.lead_contact}\n` +
            `📝 Інформація: ${leadInfo}\n\n` +
            `🆔 ID ліда: #${lead.id}`;

          const inlineKeyboard = new InlineKeyboard()
            .text('✅ Взяти в обробку', `take_lead_${lead.id}`)
            .text('❌ Відмовитися', `reject_lead_${lead.id}`);

          await bot.api.sendMessage(worker.ref_id, closerMessage, { reply_markup: inlineKeyboard });
          
          const keyboard = await getKeyboardForUser(chat_id);
          await ctx.reply('✅ Лід успішно збережено та надіслано клоузеру!', {
            reply_markup: keyboard
          });
        } catch (sendError) {
          console.error('[TEXT_HANDLER] Error sending lead to closer:', sendError);
          const keyboard = await getKeyboardForUser(chat_id);
          await ctx.reply('✅ Лід збережено, але не вдалося відправити клоузеру. Спробуйте пізніше.', {
            reply_markup: keyboard
          });
        }
        return;
      } else {
        // Якщо крок не визначено, починаємо з першого
        await setAwaitingAction(chat_id, 'lead', 'lead_name', {});
        await ctx.reply(
          '👤 Заповніть форму ліда.\n\n' +
          '👤 Крок 1/3: Вкажіть ім\'я ліда\n' +
          'Наприклад: Іван Петров',
          { reply_markup: keyboard }
        );
        return;
      }
    }

    // Перевіряємо, чи очікується передача ліда
    const awaitingActionLead = await getAwaitingAction(chat_id);
    if (awaitingActionLead === 'lead') {
      console.log('[TEXT_HANDLER] Processing lead (text) for chat_id:', chat_id);
      // Обробка ліда (існуючий код)
      const { data: worker } = await supabase
        .from('analytics-users')
        .select('ref_id, username, first_name')
        .eq('chat_id', chat_id)
        .single();

      if (!worker || !worker.ref_id) {
        await setAwaitingAction(chat_id, null);
        await ctx.reply('❌ Ви не прив\'язані до клоузера.');
        return;
      }

      // Парсимо інформацію про ліда
      let leadName = '';
      let leadContact = '';
      let leadInfo = text;

      const nameMatch = text.match(/ім['\']я[:\s]+(.+)/i) || text.match(/name[:\s]+(.+)/i);
      const contactMatch = text.match(/контакт[:\s]+(.+)/i) || text.match(/contact[:\s]+(.+)/i) || text.match(/телефон[:\s]+(.+)/i) || text.match(/phone[:\s]+(.+)/i);
      const infoMatch = text.match(/інформація[:\s]+(.+)/i) || text.match(/info[:\s]+(.+)/i);

      if (nameMatch) {
        leadName = nameMatch[1].split('\n')[0].trim();
        leadInfo = text.replace(nameMatch[0], '').trim();
      }
      if (contactMatch) {
        leadContact = contactMatch[1].split('\n')[0].trim();
        leadInfo = leadInfo.replace(contactMatch[0], '').trim();
      }
      if (infoMatch) {
        leadInfo = infoMatch[1].trim();
      }

      if (!leadName && !leadContact) {
        leadInfo = text;
      }

      const leadData = {
        worker_chat_id: chat_id,
        closer_chat_id: worker.ref_id,
        lead_name: leadName || null,
        lead_contact: leadContact || null,
        lead_info: leadInfo,
        lead_status: 'new',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      console.log('[TEXT_HANDLER] Attempting to save lead:', JSON.stringify(leadData, null, 2));

      const { data: lead, error: insertError } = await supabase
        .from('worker_leads')
        .insert(leadData)
        .select()
        .single();

      if (insertError) {
        console.error('[TEXT_HANDLER] Error saving lead:', insertError);
        await setAwaitingAction(chat_id, null);
        await ctx.reply(`❌ Помилка при збереженні ліда: ${insertError.message || 'Unknown error'}`);
        return;
      }

      if (!lead) {
        console.error('[TEXT_HANDLER] Lead was not returned after insert');
        await setAwaitingAction(chat_id, null);
        await ctx.reply('❌ Помилка: лід не було збережено.');
        return;
      }

      console.log('[TEXT_HANDLER] Lead saved successfully. Lead ID:', lead.id);
      await setAwaitingAction(chat_id, null);

      // Відправляємо інформацію про ліда клоузеру
      const workerName = `@${worker.username || worker.first_name || 'Unknown'}`;
      const leadDate = new Date(lead.created_at).toLocaleString('uk-UA');
      
      let closerMessage = `👤 Новий лід від воркера ${workerName}\n📅 ${leadDate}\n\n`;
      
      if (leadName) {
        closerMessage += `👤 Ім'я: ${leadName}\n`;
      }
      if (leadContact) {
        closerMessage += `📞 Контакт: ${leadContact}\n`;
      }
      closerMessage += `\n📝 Інформація:\n${leadInfo}`;

      // Створюємо inline клавіатуру з кнопками для клоузера
      const leadKeyboard = new InlineKeyboard()
        .text('✅ Взяти в обробку', `take_lead_${lead.id}`)
        .text('❌ Відмовитися', `reject_lead_${lead.id}`);

      console.log('[TEXT_HANDLER] Sending lead to closer:', worker.ref_id);
      await bot.api.sendMessage(worker.ref_id, closerMessage, {
        reply_markup: leadKeyboard
      });

      const keyboard = await getKeyboardForUser(chat_id);
      await ctx.reply('✅ Лід успішно передано клоузеру!', {
        reply_markup: keyboard
      });
      return;
    }

    // Перевіряємо, чи очікується звіт від клоузера
    const awaitingActionCloser = await getAwaitingAction(chat_id);
    if (awaitingActionCloser === 'closer_report') {
      console.log('[TEXT_HANDLER] Processing closer report (text) for chat_id:', chat_id);
      // Обробка звіту клоузера (існуючий код)
      const { data: closer } = await supabase
        .from('analytics-users')
        .select('role, username, first_name')
        .eq('chat_id', chat_id)
        .single();

      if (!closer || closer.role !== 'closer') {
        await setAwaitingAction(chat_id, null);
        await ctx.reply('❌ Ця функція доступна тільки для клоузерів.');
        return;
      }

      const reportData = {
        closer_chat_id: chat_id,
        message_text: text,
        message_type: 'text',
        file_id: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      console.log('[TEXT_HANDLER] Attempting to save closer report:', JSON.stringify(reportData, null, 2));

      const { data: report, error: insertError } = await supabase
        .from('closer_reports')
        .insert(reportData)
        .select()
        .single();

      if (insertError) {
        console.error('[TEXT_HANDLER] Error saving closer report:', insertError);
        await setAwaitingAction(chat_id, null);
        await ctx.reply(`❌ Помилка при збереженні звіту: ${insertError.message || 'Unknown error'}`);
        return;
      }

      if (!report) {
        console.error('[TEXT_HANDLER] Closer report was not returned after insert');
        await setAwaitingAction(chat_id, null);
        await ctx.reply('❌ Помилка: звіт не було збережено.');
        return;
      }

      console.log('[TEXT_HANDLER] Closer report saved successfully. Report ID:', report.id);
      await setAwaitingAction(chat_id, null);

      const keyboard = await getKeyboardForUser(chat_id);
      await ctx.reply('✅ Звіт успішно збережено!', {
        reply_markup: keyboard
      });
      return;
    }

    // Обробка команд від Keyboard кнопок
    const { data: user } = await supabase
      .from('analytics-users')
      .select('role')
      .eq('chat_id', chat_id)
      .single();

    if (!user) return;

    // Команди для клоузера
    if (user.role === 'closer') {
      if (text === '🔗 Створити посилання') {
        const botUsername = (await bot.api.getMe()).username;
        const referralLink = `https://t.me/${botUsername}?start=closer_${chat_id}`;
        const keyboard = await getKeyboardForUser(chat_id);
        await ctx.reply(
          `🔗 Ваше реферальне посилання:\n\n${referralLink}\n\n📋 Скопіюйте це посилання та надішліть його воркерам.`,
          { reply_markup: keyboard }
        );
        return;
      }
      if (text === '👥 Мої воркери') {
        // Викликаємо ту саму логіку, що і в callbackQuery
        const { data: workers } = await supabase
          .from('analytics-users')
          .select('chat_id, username, first_name, created_at')
          .eq('ref_id', chat_id)
          .order('created_at', { ascending: false });
        
        if (!workers || workers.length === 0) {
          const keyboard = await getKeyboardForUser(chat_id);
          await ctx.reply('👥 У вас поки немає прив\'язаних воркерів.', { reply_markup: keyboard });
          return;
        }
        
        // Отримуємо статистику для кожного воркера
        const workersWithStats = await Promise.all(
          workers.map(async (worker) => {
            const workerChatId = worker.chat_id;
            
            // Кількість звітів
            const { count: reportsCount } = await supabase
              .from('worker_reports')
              .select('*', { count: 'exact', head: true })
              .eq('worker_chat_id', workerChatId)
              .eq('closer_chat_id', chat_id);
            
            // Активні ліди (new + contacted)
            const { count: activeLeadsCount } = await supabase
              .from('worker_leads')
              .select('*', { count: 'exact', head: true })
              .eq('worker_chat_id', workerChatId)
              .eq('closer_chat_id', chat_id)
              .in('lead_status', ['new', 'contacted']);
            
            // Відмовлені ліди
            const { count: rejectedLeadsCount } = await supabase
              .from('worker_leads')
              .select('*', { count: 'exact', head: true })
              .eq('worker_chat_id', workerChatId)
              .eq('closer_chat_id', chat_id)
              .eq('lead_status', 'rejected');
            
            // Закриті ліди
            const { count: closedLeadsCount } = await supabase
              .from('worker_leads')
              .select('*', { count: 'exact', head: true })
              .eq('worker_chat_id', workerChatId)
              .eq('closer_chat_id', chat_id)
              .eq('lead_status', 'closed');
            
            return {
              ...worker,
              reportsCount: reportsCount || 0,
              activeLeadsCount: activeLeadsCount || 0,
              rejectedLeadsCount: rejectedLeadsCount || 0,
              closedLeadsCount: closedLeadsCount || 0
            };
          })
        );
        
        // Створюємо inline клавіатуру з кнопками для кожного воркера
        const workersKeyboard = new InlineKeyboard();
        let workersList = `👥 Ваші воркери (${workers.length}):\n\n`;
        
        workersWithStats.forEach((worker, idx) => {
          const date = new Date(worker.created_at).toLocaleDateString('uk-UA');
          const workerName = `@${worker.username || worker.first_name || 'Unknown'}`;
          workersList += `${idx + 1}. ${workerName} (${worker.first_name || 'No name'})\n`;
          workersList += `   📅 Приєднався: ${date}\n`;
          workersList += `   📋 Звіти: ${worker.reportsCount}\n`;
          workersList += `   ✅ Активні ліди: ${worker.activeLeadsCount}\n`;
          workersList += `   ❌ Відмовлені ліди: ${worker.rejectedLeadsCount}\n`;
          workersList += `   🔒 Закриті ліди: ${worker.closedLeadsCount}\n\n`;
          
          // Додаємо кнопки для кожного воркера
          workersKeyboard
            .text(`📋 Звіти`, `worker_reports_${worker.chat_id}`).row()
            .text(`✅ Активні ліди`, `worker_active_leads_${worker.chat_id}`).row()
            .text(`❌ Відмовлені ліди`, `worker_rejected_leads_${worker.chat_id}`).row()
            .text(`🔒 Закриті ліди`, `worker_closed_leads_${worker.chat_id}`).row();
        });
        
        const keyboard = await getKeyboardForUser(chat_id);
        await ctx.reply(workersList, { 
          reply_markup: workersKeyboard
        });
        return;
      }
      if (text === '📋 Звіти за сьогодні') {
        // Отримуємо всі звіти за сьогодні
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayStart = today.toISOString();
        const todayEnd = new Date(today.getTime() + 24 * 60 * 60 * 1000).toISOString();

        const { data: reports, error: reportsError } = await supabase
          .from('worker_reports')
          .select('*')
          .eq('closer_chat_id', chat_id)
          .gte('created_at', todayStart)
          .lt('created_at', todayEnd)
          .order('created_at', { ascending: false });

        if (reportsError) {
          console.error('[REPORTS_TODAY] Error fetching reports:', reportsError);
          const keyboard = await getKeyboardForUser(chat_id);
          await ctx.reply('❌ Помилка при отриманні звітів.', { reply_markup: keyboard });
          return;
        }

        if (!reports || reports.length === 0) {
          const keyboard = await getKeyboardForUser(chat_id);
          await ctx.reply('📋 За сьогодні звітів немає.', { reply_markup: keyboard });
          return;
        }

        // Отримуємо інформацію про воркерів
        const workerChatIds = [...new Set(reports.map((r: any) => r.worker_chat_id))];
        const { data: workers } = await supabase
          .from('analytics-users')
          .select('chat_id, username, first_name')
          .in('chat_id', workerChatIds);

        const workersMap = new Map();
        workers?.forEach((w: any) => {
          workersMap.set(w.chat_id, w);
        });

        // Форматуємо звіти з обмеженням довжини
        const MAX_MESSAGE_LENGTH = 4000;
        let reportsText = `📋 Звіти за сьогодні (${reports.length}):\n\n`;
        const reportsKeyboard = new InlineKeyboard();
        let currentLength = reportsText.length;
        let displayedCount = 0;
        
        for (let idx = 0; idx < reports.length; idx++) {
          const report = reports[idx];
          const worker = workersMap.get(report.worker_chat_id);
          const workerName = worker 
            ? `@${worker.username || worker.first_name || 'Unknown'}`
            : 'Невідомий воркер';
          const reportDate = new Date(report.created_at).toLocaleString('uk-UA');
          const status = report.status === 'read' ? '✅ Прочитано' : '📬 Непрочитано';
          
          let reportText = `${idx + 1}. ${status}\n`;
          reportText += `   👤 Воркер: ${workerName}\n`;
          reportText += `   📅 ${reportDate}\n`;
          
          // Обмежуємо довжину тексту звіту до 100 символів
          if (report.message_type === 'photo') {
            const text = report.message_text || '(без підпису)';
            const shortText = text.length > 100 ? text.substring(0, 100) + '...' : text;
            reportText += `   📷 Фото: ${shortText}\n`;
          } else if (report.message_type === 'document') {
            const text = report.message_text || '(без опису)';
            const shortText = text.length > 100 ? text.substring(0, 100) + '...' : text;
            reportText += `   📄 Документ: ${shortText}\n`;
          } else if (report.message_type === 'video') {
            const text = report.message_text || '(без підпису)';
            const shortText = text.length > 100 ? text.substring(0, 100) + '...' : text;
            reportText += `   🎥 Відео: ${shortText}\n`;
          } else {
            const text = report.message_text || '';
            const shortText = text.length > 100 ? text.substring(0, 100) + '...' : text;
            reportText += `   💬 ${shortText}\n`;
          }
          
          reportText += '\n';
          
          // Перевіряємо, чи не перевищимо ліміт
          if (currentLength + reportText.length > MAX_MESSAGE_LENGTH) {
            break;
          }
          
          reportsText += reportText;
          currentLength += reportText.length;
          displayedCount++;
          
          // Додаємо кнопку для перегляду повного звіту
          const fullText = report.message_text || '';
          if (fullText.length > 100 || report.message_type !== 'text') {
            reportsKeyboard.text(`👁️ Переглянути звіт #${report.id}`, `view_full_report_${report.id}`).row();
          }
        }
        
        // Якщо не всі звіти відображені, додаємо інформацію
        if (displayedCount < reports.length) {
          reportsText += `\n... та ще ${reports.length - displayedCount} звітів (повідомлення обрізано через обмеження Telegram)`;
        }

        const keyboard = await getKeyboardForUser(chat_id);
        // Якщо є кнопки для перегляду повних звітів, показуємо їх
        if (reportsKeyboard.inline_keyboard.length > 0) {
          await ctx.reply(reportsText, { reply_markup: reportsKeyboard });
        } else {
          await ctx.reply(reportsText, { reply_markup: keyboard });
        }
        return;
      }

      if (text === '👤 Звіти воркера') {
        // Спочатку показуємо список воркерів для вибору
        const { data: workers } = await supabase
          .from('analytics-users')
          .select('chat_id, username, first_name')
          .eq('ref_id', chat_id)
          .eq('role', 'worker')
          .order('first_name', { ascending: true });

        if (!workers || workers.length === 0) {
          const keyboard = await getKeyboardForUser(chat_id);
          await ctx.reply('👥 У вас немає воркерів.', { reply_markup: keyboard });
          return;
        }

        // Створюємо inline клавіатуру зі списком воркерів
        const workersKeyboard = new InlineKeyboard();
        workers.forEach((worker: any) => {
          const workerName = `@${worker.username || worker.first_name || 'Unknown'}`;
          workersKeyboard.text(workerName, `worker_reports_${worker.chat_id}`).row();
        });

        const keyboard = await getKeyboardForUser(chat_id);
        await ctx.reply('👤 Оберіть воркера для перегляду звітів:', {
          reply_markup: workersKeyboard
        });
        return;
      }

      if (text === '📋 Заявки по лідам') {
        // Отримуємо всі ліди від воркерів
        const { data: leads, error: leadsError } = await supabase
          .from('worker_leads')
          .select('*')
          .eq('closer_chat_id', chat_id)
          .order('created_at', { ascending: false })
          .limit(100); // Обмежуємо до 100 останніх лідов

        if (leadsError) {
          console.error('[LEADS_ALL] Error fetching leads:', leadsError);
          const keyboard = await getKeyboardForUser(chat_id);
          await ctx.reply('❌ Помилка при отриманні лідов.', { reply_markup: keyboard });
          return;
        }

        if (!leads || leads.length === 0) {
          const keyboard = await getKeyboardForUser(chat_id);
          await ctx.reply('📋 Заявок по лідам поки немає.', { reply_markup: keyboard });
          return;
        }

        // Отримуємо інформацію про воркерів
        const workerChatIds = [...new Set(leads.map((l: any) => l.worker_chat_id))];
        const { data: workers } = await supabase
          .from('analytics-users')
          .select('chat_id, username, first_name')
          .in('chat_id', workerChatIds);

        const workersMap = new Map();
        workers?.forEach((w: any) => {
          workersMap.set(w.chat_id, w);
        });

        // Групуємо ліди за статусом
        const leadsByStatus = {
          new: leads.filter((l: any) => l.lead_status === 'new'),
          contacted: leads.filter((l: any) => l.lead_status === 'contacted'),
          converted: leads.filter((l: any) => l.lead_status === 'converted'),
          lost: leads.filter((l: any) => l.lead_status === 'lost')
        };

        // Форматуємо ліди з inline кнопками
        let leadsText = `📋 Заявки по лідам (всього: ${leads.length}):\n\n`;
        const leadsKeyboard = new InlineKeyboard();
        
        // Нові ліди
        if (leadsByStatus.new.length > 0) {
          leadsText += `🆕 Нові (${leadsByStatus.new.length}):\n`;
          leadsByStatus.new.forEach((lead: any, idx: number) => {
            const worker = workersMap.get(lead.worker_chat_id);
            const workerName = worker 
              ? `@${worker.username || worker.first_name || 'Unknown'}`
              : 'Невідомий воркер';
            const leadDate = new Date(lead.created_at).toLocaleString('uk-UA');
            
            leadsText += `\n${idx + 1}. 👤 Воркер: ${workerName}\n`;
            leadsText += `   📅 ${leadDate}\n`;
            if (lead.lead_name) {
              leadsText += `   👤 Ім'я: ${lead.lead_name}\n`;
            }
            if (lead.lead_contact) {
              leadsText += `   📞 Контакт: ${lead.lead_contact}\n`;
            }
            if (lead.lead_info) {
              leadsText += `   📝 Інформація: ${lead.lead_info}\n`;
            }
            
            // Додаємо кнопку "Взяти в обробку" для нового ліда
            leadsKeyboard.text(`✅ Взяти в обробку #${lead.id}`, `take_lead_${lead.id}`).row();
          });
          leadsText += '\n';
        }

        // Зв'язався
        if (leadsByStatus.contacted.length > 0) {
          leadsText += `📞 Зв'язався (${leadsByStatus.contacted.length}):\n`;
          leadsByStatus.contacted.forEach((lead: any, idx: number) => {
            const worker = workersMap.get(lead.worker_chat_id);
            const workerName = worker 
              ? `@${worker.username || worker.first_name || 'Unknown'}`
              : 'Невідомий воркер';
            const leadDate = new Date(lead.created_at).toLocaleString('uk-UA');
            
            leadsText += `\n${idx + 1}. 👤 Воркер: ${workerName}\n`;
            leadsText += `   📅 ${leadDate}\n`;
            if (lead.lead_name) {
              leadsText += `   👤 Ім'я: ${lead.lead_name}\n`;
            }
            if (lead.lead_contact) {
              leadsText += `   📞 Контакт: ${lead.lead_contact}\n`;
            }
          });
          leadsText += '\n';
        }

        // Конвертувався
        if (leadsByStatus.converted.length > 0) {
          leadsText += `✅ Конвертувався (${leadsByStatus.converted.length}):\n`;
          leadsByStatus.converted.forEach((lead: any, idx: number) => {
            const worker = workersMap.get(lead.worker_chat_id);
            const workerName = worker 
              ? `@${worker.username || worker.first_name || 'Unknown'}`
              : 'Невідомий воркер';
            const leadDate = new Date(lead.created_at).toLocaleString('uk-UA');
            
            leadsText += `\n${idx + 1}. 👤 Воркер: ${workerName}\n`;
            leadsText += `   📅 ${leadDate}\n`;
            if (lead.lead_name) {
              leadsText += `   👤 Ім'я: ${lead.lead_name}\n`;
            }
            if (lead.lead_contact) {
              leadsText += `   📞 Контакт: ${lead.lead_contact}\n`;
            }
          });
          leadsText += '\n';
        }

        // Втрачений
        if (leadsByStatus.lost.length > 0) {
          leadsText += `❌ Втрачений (${leadsByStatus.lost.length}):\n`;
          leadsByStatus.lost.forEach((lead: any, idx: number) => {
            const worker = workersMap.get(lead.worker_chat_id);
            const workerName = worker 
              ? `@${worker.username || worker.first_name || 'Unknown'}`
              : 'Невідомий воркер';
            const leadDate = new Date(lead.created_at).toLocaleString('uk-UA');
            
            leadsText += `\n${idx + 1}. 👤 Воркер: ${workerName}\n`;
            leadsText += `   📅 ${leadDate}\n`;
            if (lead.lead_name) {
              leadsText += `   👤 Ім'я: ${lead.lead_name}\n`;
            }
            if (lead.lead_contact) {
              leadsText += `   📞 Контакт: ${lead.lead_contact}\n`;
            }
          });
        }

        const keyboard = await getKeyboardForUser(chat_id);
        // Якщо є нові ліди, показуємо з inline кнопками, інакше просто текст
        if (leadsByStatus.new.length > 0) {
          await ctx.reply(leadsText, { reply_markup: leadsKeyboard });
        } else {
          await ctx.reply(leadsText, { reply_markup: keyboard });
        }
        return;
      }

      if (text === '✅ Активні ліди') {
        // Активні ліди - це нові (new) та в обробці (contacted)
        const { data: activeLeads, error: activeLeadsError } = await supabase
          .from('worker_leads')
          .select('*')
          .eq('closer_chat_id', chat_id)
          .in('lead_status', ['new', 'contacted'])
          .order('created_at', { ascending: false })
          .limit(100);

        if (activeLeadsError) {
          console.error('[ACTIVE_LEADS] Error fetching leads:', activeLeadsError);
          const keyboard = await getKeyboardForUser(chat_id);
          await ctx.reply('❌ Помилка при отриманні активних лідов.', { reply_markup: keyboard });
          return;
        }

        if (!activeLeads || activeLeads.length === 0) {
          const keyboard = await getKeyboardForUser(chat_id);
          await ctx.reply('✅ Активних лідов немає.', { reply_markup: keyboard });
          return;
        }

        // Отримуємо інформацію про воркерів
        const workerChatIds = [...new Set(activeLeads.map((l: any) => l.worker_chat_id))];
        const { data: workers } = await supabase
          .from('analytics-users')
          .select('chat_id, username, first_name')
          .in('chat_id', workerChatIds);

        const workersMap = new Map();
        workers?.forEach((w: any) => {
          workersMap.set(w.chat_id, w);
        });

        // Групуємо за статусом
        const newLeads = activeLeads.filter((l: any) => l.lead_status === 'new');
        const contactedLeads = activeLeads.filter((l: any) => l.lead_status === 'contacted');

        let activeLeadsText = `✅ Активні ліди (всього: ${activeLeads.length}):\n\n`;
        const activeLeadsKeyboard = new InlineKeyboard();

        // Нові ліди
        if (newLeads.length > 0) {
          activeLeadsText += `🆕 Нові (${newLeads.length}):\n`;
          newLeads.forEach((lead: any, idx: number) => {
            const worker = workersMap.get(lead.worker_chat_id);
            const workerName = worker 
              ? `@${worker.username || worker.first_name || 'Unknown'}`
              : 'Невідомий воркер';
            const leadDate = new Date(lead.created_at).toLocaleString('uk-UA');
            
            activeLeadsText += `\n${idx + 1}. 👤 Воркер: ${workerName}\n`;
            activeLeadsText += `   📅 ${leadDate}\n`;
            if (lead.lead_name) {
              activeLeadsText += `   👤 Ім'я: ${lead.lead_name}\n`;
            }
            if (lead.lead_contact) {
              activeLeadsText += `   📞 Контакт: ${lead.lead_contact}\n`;
            }
            if (lead.lead_info) {
              activeLeadsText += `   📝 Інформація: ${lead.lead_info}\n`;
            }
            
            activeLeadsKeyboard.text(`✅ Взяти в обробку #${lead.id}`, `take_lead_${lead.id}`).row();
          });
          activeLeadsText += '\n';
        }

        // В обробці
        if (contactedLeads.length > 0) {
          activeLeadsText += `📞 В обробці (${contactedLeads.length}):\n`;
          contactedLeads.forEach((lead: any, idx: number) => {
            const worker = workersMap.get(lead.worker_chat_id);
            const workerName = worker 
              ? `@${worker.username || worker.first_name || 'Unknown'}`
              : 'Невідомий воркер';
            const leadDate = new Date(lead.created_at).toLocaleString('uk-UA');
            
            activeLeadsText += `\n${idx + 1}. 👤 Воркер: ${workerName}\n`;
            activeLeadsText += `   📅 ${leadDate}\n`;
            if (lead.lead_name) {
              activeLeadsText += `   👤 Ім'я: ${lead.lead_name}\n`;
            }
            if (lead.lead_contact) {
              activeLeadsText += `   📞 Контакт: ${lead.lead_contact}\n`;
            }
            if (lead.lead_info) {
              activeLeadsText += `   📝 Інформація: ${lead.lead_info}\n`;
            }
            
            // Додаємо кнопку для зміни статусу на неактивний
            activeLeadsKeyboard.text(`❌ Зробити неактивним #${lead.id}`, `deactivate_lead_${lead.id}`).row();
          });
        }

        const keyboard = await getKeyboardForUser(chat_id);
        // Якщо є нові ліди або ліди в обробці, показуємо з inline кнопками
        if (newLeads.length > 0 || contactedLeads.length > 0) {
          await ctx.reply(activeLeadsText, { reply_markup: activeLeadsKeyboard });
        } else {
          await ctx.reply(activeLeadsText, { reply_markup: keyboard });
        }
        return;
      }

      if (text === '❌ Неактивні ліди') {
        // Неактивні ліди - це конвертовані (converted), втрачені (lost), відмовлені (rejected) та закриті (closed)
        const { data: inactiveLeads, error: inactiveLeadsError } = await supabase
          .from('worker_leads')
          .select('*')
          .eq('closer_chat_id', chat_id)
          .in('lead_status', ['converted', 'lost', 'rejected', 'closed'])
          .order('created_at', { ascending: false })
          .limit(100);

        if (inactiveLeadsError) {
          console.error('[INACTIVE_LEADS] Error fetching leads:', inactiveLeadsError);
          const keyboard = await getKeyboardForUser(chat_id);
          await ctx.reply('❌ Помилка при отриманні неактивних лідов.', { reply_markup: keyboard });
          return;
        }

        if (!inactiveLeads || inactiveLeads.length === 0) {
          const keyboard = await getKeyboardForUser(chat_id);
          await ctx.reply('❌ Неактивних лідов немає.', { reply_markup: keyboard });
          return;
        }

        // Отримуємо інформацію про воркерів
        const workerChatIds = [...new Set(inactiveLeads.map((l: any) => l.worker_chat_id))];
        const { data: workers } = await supabase
          .from('analytics-users')
          .select('chat_id, username, first_name')
          .in('chat_id', workerChatIds);

        const workersMap = new Map();
        workers?.forEach((w: any) => {
          workersMap.set(w.chat_id, w);
        });

        // Групуємо за статусом
        const convertedLeads = inactiveLeads.filter((l: any) => l.lead_status === 'converted');
        const lostLeads = inactiveLeads.filter((l: any) => l.lead_status === 'lost');
        const rejectedLeads = inactiveLeads.filter((l: any) => l.lead_status === 'rejected');
        const closedLeads = inactiveLeads.filter((l: any) => l.lead_status === 'closed');

        let inactiveLeadsText = `❌ Неактивні ліди (всього: ${inactiveLeads.length}):\n\n`;

        // Створюємо inline клавіатуру для неактивних лідов
        const inactiveLeadsKeyboard = new InlineKeyboard();

        // Конвертовані
        if (convertedLeads.length > 0) {
          inactiveLeadsText += `✅ Конвертовані (${convertedLeads.length}):\n`;
          convertedLeads.forEach((lead: any, idx: number) => {
            const worker = workersMap.get(lead.worker_chat_id);
            const workerName = worker 
              ? `@${worker.username || worker.first_name || 'Unknown'}`
              : 'Невідомий воркер';
            const leadDate = new Date(lead.created_at).toLocaleString('uk-UA');
            
            inactiveLeadsText += `\n${idx + 1}. 👤 Воркер: ${workerName}\n`;
            inactiveLeadsText += `   📅 ${leadDate}\n`;
            if (lead.lead_name) {
              inactiveLeadsText += `   👤 Ім'я: ${lead.lead_name}\n`;
            }
            if (lead.lead_contact) {
              inactiveLeadsText += `   📞 Контакт: ${lead.lead_contact}\n`;
            }
            if (lead.lead_info) {
              inactiveLeadsText += `   📝 Інформація: ${lead.lead_info}\n`;
            }
            
            // Додаємо кнопку для зміни статусу на активний
            inactiveLeadsKeyboard.text(`✅ Зробити активним #${lead.id}`, `activate_lead_${lead.id}`).row();
          });
          inactiveLeadsText += '\n';
        }

        // Втрачені
        if (lostLeads.length > 0) {
          inactiveLeadsText += `❌ Втрачені (${lostLeads.length}):\n`;
          lostLeads.forEach((lead: any, idx: number) => {
            const worker = workersMap.get(lead.worker_chat_id);
            const workerName = worker 
              ? `@${worker.username || worker.first_name || 'Unknown'}`
              : 'Невідомий воркер';
            const leadDate = new Date(lead.created_at).toLocaleString('uk-UA');
            
            inactiveLeadsText += `\n${idx + 1}. 👤 Воркер: ${workerName}\n`;
            inactiveLeadsText += `   📅 ${leadDate}\n`;
            if (lead.lead_name) {
              inactiveLeadsText += `   👤 Ім'я: ${lead.lead_name}\n`;
            }
            if (lead.lead_contact) {
              inactiveLeadsText += `   📞 Контакт: ${lead.lead_contact}\n`;
            }
            if (lead.lead_info) {
              inactiveLeadsText += `   📝 Інформація: ${lead.lead_info}\n`;
            }
            
            // Додаємо кнопку для зміни статусу на активний
            inactiveLeadsKeyboard.text(`✅ Зробити активним #${lead.id}`, `activate_lead_${lead.id}`).row();
          });
          inactiveLeadsText += '\n';
        }

        // Відмовлені
        if (rejectedLeads.length > 0) {
          inactiveLeadsText += `🚫 Відмовлені (${rejectedLeads.length}):\n`;
          rejectedLeads.forEach((lead: any, idx: number) => {
            const worker = workersMap.get(lead.worker_chat_id);
            const workerName = worker 
              ? `@${worker.username || worker.first_name || 'Unknown'}`
              : 'Невідомий воркер';
            const leadDate = new Date(lead.created_at).toLocaleString('uk-UA');
            
            inactiveLeadsText += `\n${idx + 1}. 👤 Воркер: ${workerName}\n`;
            inactiveLeadsText += `   📅 ${leadDate}\n`;
            if (lead.lead_name) {
              inactiveLeadsText += `   👤 Ім'я: ${lead.lead_name}\n`;
            }
            if (lead.lead_contact) {
              inactiveLeadsText += `   📞 Контакт: ${lead.lead_contact}\n`;
            }
            if (lead.lead_info) {
              inactiveLeadsText += `   📝 Інформація: ${lead.lead_info}\n`;
            }
            
            // Додаємо кнопку для зміни статусу на активний
            inactiveLeadsKeyboard.text(`✅ Зробити активним #${lead.id}`, `activate_lead_${lead.id}`).row();
          });
          inactiveLeadsText += '\n';
        }

        // Закриті
        if (closedLeads.length > 0) {
          inactiveLeadsText += `🔒 Закриті (${closedLeads.length}):\n`;
          closedLeads.forEach((lead: any, idx: number) => {
            const worker = workersMap.get(lead.worker_chat_id);
            const workerName = worker 
              ? `@${worker.username || worker.first_name || 'Unknown'}`
              : 'Невідомий воркер';
            const leadDate = new Date(lead.created_at).toLocaleString('uk-UA');
            
            inactiveLeadsText += `\n${idx + 1}. 👤 Воркер: ${workerName}\n`;
            inactiveLeadsText += `   📅 ${leadDate}\n`;
            if (lead.lead_name) {
              inactiveLeadsText += `   👤 Ім'я: ${lead.lead_name}\n`;
            }
            if (lead.lead_contact) {
              inactiveLeadsText += `   📞 Контакт: ${lead.lead_contact}\n`;
            }
            if (lead.lead_info) {
              inactiveLeadsText += `   📝 Інформація: ${lead.lead_info}\n`;
            }
            
            // Додаємо кнопку для зміни статусу на активний
            inactiveLeadsKeyboard.text(`✅ Зробити активним #${lead.id}`, `activate_lead_${lead.id}`).row();
          });
        }

        const keyboard = await getKeyboardForUser(chat_id);
        // Якщо є неактивні ліди, показуємо з inline кнопками
        if (convertedLeads.length > 0 || lostLeads.length > 0 || rejectedLeads.length > 0 || closedLeads.length > 0) {
          await ctx.reply(inactiveLeadsText, { reply_markup: inactiveLeadsKeyboard });
        } else {
          await ctx.reply(inactiveLeadsText, { reply_markup: keyboard });
        }
        return;
      }

      if (text === '📊 Статистика по воркерам' || text === '📈 Моя статистика' || 
          text === '📋 Звіти воркерів' || text === '👤 Ліди від воркерів' ||
          text === '📝 Надіслати звіт' || text === '📅 Статистика за тиждень' ||
          text === '📆 Статистика за місяць') {
        // Ці команди обробляються через callbackQuery, але можна додати обробку тут
        // Поки що залишаємо callbackQuery обробники для цих команд
        return;
      }
    }

    // Команди для воркера
    if (user.role === 'worker') {
      if (text === '📝 Надіслати звіт') {
        const { data: worker } = await supabase
          .from('analytics-users')
          .select('ref_id')
          .eq('chat_id', chat_id)
          .single();

        if (!worker || !worker.ref_id) {
          await ctx.reply('❌ Ви не прив\'язані до клоузера.');
          return;
        }

        // Починаємо багатокрокову форму для звіту
        await setAwaitingAction(chat_id, 'report', 'report_date', {});
        console.log('[TEXT_CMD] Starting report form for chat_id:', chat_id);
        const keyboard = new InlineKeyboard().text('❌ Скасувати', 'cancel_report');
        await ctx.reply(
          '📝 Заповніть форму звіту.\n\n' +
          '📅 Крок 1/4: Вкажіть дату та час роботи\n' +
          'Наприклад: 15.12.2024, 10:00-18:00\n' +
          'Або просто: Сьогодні',
          { reply_markup: keyboard }
        );
        return;
      }
      if (text === '👤 Передати ліда') {
        const { data: worker } = await supabase
          .from('analytics-users')
          .select('ref_id')
          .eq('chat_id', chat_id)
          .single();

        if (!worker || !worker.ref_id) {
          await ctx.reply('❌ Ви не прив\'язані до клоузера.');
          return;
        }

        // Починаємо багатокрокову форму для ліда
        await setAwaitingAction(chat_id, 'lead', 'lead_name', {});
        console.log('[TEXT_CMD] Starting lead form for chat_id:', chat_id);
        const keyboard = new InlineKeyboard().text('❌ Скасувати', 'cancel_lead');
        await ctx.reply(
          '👤 Заповніть форму ліда.\n\n' +
          '👤 Крок 1/3: Вкажіть ім\'я ліда\n' +
          'Наприклад: Іван Петров',
          { reply_markup: keyboard }
        );
        return;
      }
    }
  } catch (error) {
    console.error('Error processing text message:', error);
  }
});

// Обробка повідомлень (текст, фото, документи, відео)
bot.on('message', async (ctx) => {
  try {
    console.log('[MESSAGE] ===== MESSAGE HANDLER TRIGGERED =====');
    const chat_id = ctx.message.chat.id;
    const message = ctx.message;

    // Якщо це текст, пропускаємо - обробляється в bot.on('message:text')
    if ('text' in message) {
      console.log('[MESSAGE] Text message detected, skipping (handled by message:text)');
      return;
    }

    console.log('[MESSAGE] Received non-text message from chat_id:', chat_id);
    console.log('[MESSAGE] Message type:', 'photo' in message ? 'photo' : 'document' in message ? 'document' : 'video' in message ? 'video' : 'other');
    // Стан очікування тепер зберігається в БД
    // Отримуємо стан очікування з БД
    const awaitingAction = await getAwaitingAction(chat_id);
    console.log('[MESSAGE] awaitingAction from DB:', awaitingAction);

    // Перевіряємо, чи очікується звіт від цього користувача
    if (awaitingAction === 'report') {
      console.log('[MESSAGE] Processing worker report for chat_id:', chat_id);
      
      // Перевіряємо, чи це воркер
      console.log('[MESSAGE] Fetching worker data...');
      const { data: worker, error: workerError } = await supabase
        .from('analytics-users')
        .select('ref_id, username, first_name')
        .eq('chat_id', chat_id)
        .single();

      console.log('[MESSAGE] Worker data:', worker);
      console.log('[MESSAGE] Worker error:', workerError);

      if (!worker || !worker.ref_id) {
        console.error('[MESSAGE] Worker not found or not bound to closer');
        await setAwaitingAction(chat_id, null);
        await ctx.reply('❌ Ви не прив\'язані до клоузера.');
        return;
      }

      console.log('[MESSAGE] Worker found, closer_chat_id:', worker.ref_id);

      // Витягуємо дані повідомлення
      let messageText = '';
      let messageType = 'text';
      let fileId = null;

      console.log('[MESSAGE] Extracting message data...');
      if ('text' in message && message.text) {
        messageText = message.text;
        messageType = 'text';
        console.log('[MESSAGE] Text message:', messageText);
      } else if ('photo' in message && message.photo && message.photo.length > 0) {
        messageText = message.caption || '';
        messageType = 'photo';
        fileId = message.photo[message.photo.length - 1].file_id;
        console.log('[MESSAGE] Photo message, caption:', messageText, 'file_id:', fileId);
      } else if ('document' in message && message.document) {
        messageText = message.caption || message.document.file_name || '';
        messageType = 'document';
        fileId = message.document.file_id;
        console.log('[MESSAGE] Document message, caption:', messageText, 'file_id:', fileId);
      } else if ('video' in message && message.video) {
        messageText = message.caption || '';
        messageType = 'video';
        fileId = message.video.file_id;
        console.log('[MESSAGE] Video message, caption:', messageText, 'file_id:', fileId);
      } else {
        console.error('[MESSAGE] Unsupported message type');
        await ctx.reply('❌ Підтримуються тільки текст, фото, документи та відео.');
        return;
      }

      // Зберігаємо звіт в базу
      // Переконаємося, що message_text не порожній
      if (!messageText || messageText.trim().length === 0) {
        messageText = messageType === 'photo' ? '(Фото без підпису)' : 
                      messageType === 'document' ? '(Документ)' : 
                      messageType === 'video' ? '(Відео без підпису)' : 
                      '(Без тексту)';
      }

      const reportData: any = {
        worker_chat_id: chat_id,
        closer_chat_id: worker.ref_id,
        message_text: messageText.trim(),
        message_type: messageType,
        status: 'unread'
      };

      // Додаємо file_id тільки якщо він є
      if (fileId) {
        reportData.file_id = fileId;
      }

      // created_at не передаємо - використається DEFAULT NOW()

      console.log('[MESSAGE] Attempting to save worker report:', JSON.stringify(reportData, null, 2));
      console.log('[MESSAGE] Supabase client initialized:', !!supabase);
      console.log('[MESSAGE] Supabase URL:', supabaseUrl ? 'Set' : 'NOT SET');
      console.log('[MESSAGE] Supabase Key:', supabaseKey ? 'Set (length: ' + supabaseKey.length + ')' : 'NOT SET');
      console.log('[MESSAGE] Table: worker_reports');

      const { data: report, error: insertError } = await supabase
        .from('worker_reports')
        .insert(reportData)
        .select()
        .single();

      console.log('[MESSAGE] ===== INSERT RESULT =====');
      console.log('[MESSAGE] Insert result - data:', report ? JSON.stringify(report, null, 2) : 'null');
      console.log('[MESSAGE] Insert result - error:', insertError ? JSON.stringify(insertError, null, 2) : 'null');
      console.log('[MESSAGE] =======================');

      if (insertError) {
        console.error('[MESSAGE] Error saving worker report:', insertError);
        console.error('[MESSAGE] Error code:', insertError.code);
        console.error('[MESSAGE] Error message:', insertError.message);
        console.error('[MESSAGE] Error details:', JSON.stringify(insertError, null, 2));
        console.error('[MESSAGE] Error hint:', insertError.hint);
        await setAwaitingAction(chat_id, null);
        await ctx.reply(`❌ Помилка при збереженні звіту: ${insertError.message || insertError.code || 'Unknown error'}`);
        return;
      }

      if (!report) {
        console.error('[MESSAGE] Report was not returned after insert - data is null');
        await setAwaitingAction(chat_id, null);
        await ctx.reply('❌ Помилка: звіт не було збережено (дані не повернуто).');
        return;
      }

      console.log('[MESSAGE] Worker report saved successfully. Report ID:', report.id);
      console.log('[MESSAGE] Saved report data:', JSON.stringify(report, null, 2));

      // Видаляємо прапорець очікування
      await setAwaitingAction(chat_id, null);
      console.log('[MESSAGE] Removed awaitingAction for chat_id:', chat_id);

      // Відправляємо звіт клоузеру
      console.log('[MESSAGE] Attempting to send report to closer, closer_chat_id:', worker.ref_id);
      try {
        const workerName = `@${worker.username || worker.first_name || 'Unknown'}`;
        const reportDate = new Date(report.created_at).toLocaleString('uk-UA');
        
        let closerMessage = `📋 Новий звіт від воркера ${workerName}\n📅 ${reportDate}\n\n`;

        console.log('[MESSAGE] Preparing to send message to closer. Message type:', messageType);
        
        if (messageType === 'text') {
          closerMessage += messageText;
          console.log('[MESSAGE] Sending text message to closer:', closerMessage);
          const sendResult = await bot.api.sendMessage(worker.ref_id, closerMessage);
          console.log('[MESSAGE] Text message sent successfully. Message ID:', sendResult.message_id);
        } else if (messageType === 'photo' && fileId) {
          closerMessage += messageText || '(Фото без підпису)';
          console.log('[MESSAGE] Sending photo to closer. File ID:', fileId, 'Caption:', closerMessage);
          const sendResult = await bot.api.sendPhoto(worker.ref_id, fileId, { caption: closerMessage });
          console.log('[MESSAGE] Photo sent successfully. Message ID:', sendResult.message_id);
        } else if (messageType === 'document' && fileId) {
          closerMessage += messageText || '(Документ)';
          console.log('[MESSAGE] Sending document to closer. File ID:', fileId, 'Caption:', closerMessage);
          const sendResult = await bot.api.sendDocument(worker.ref_id, fileId, { caption: closerMessage });
          console.log('[MESSAGE] Document sent successfully. Message ID:', sendResult.message_id);
        } else if (messageType === 'video' && fileId) {
          closerMessage += messageText || '(Відео без підпису)';
          console.log('[MESSAGE] Sending video to closer. File ID:', fileId, 'Caption:', closerMessage);
          const sendResult = await bot.api.sendVideo(worker.ref_id, fileId, { caption: closerMessage });
          console.log('[MESSAGE] Video sent successfully. Message ID:', sendResult.message_id);
        }

        console.log('[MESSAGE] Report successfully sent to closer');

        // Підтвердження воркеру
        const keyboard = await getKeyboardForUser(chat_id);
        await ctx.reply('✅ Звіт успішно збережено та надіслано клоузеру!', {
          reply_markup: keyboard
        });
        console.log('[MESSAGE] Confirmation sent to worker');
      } catch (sendError) {
        console.error('[MESSAGE] Error sending report to closer:', sendError);
        console.error('[MESSAGE] Error type:', sendError instanceof Error ? sendError.constructor.name : typeof sendError);
        console.error('[MESSAGE] Error message:', sendError instanceof Error ? sendError.message : String(sendError));
        console.error('[MESSAGE] Error stack:', sendError instanceof Error ? sendError.stack : 'No stack');
        // Навіть якщо не вдалося відправити, звіт вже збережено в базі
        const keyboard = await getKeyboardForUser(chat_id);
        await ctx.reply('✅ Звіт збережено, але не вдалося відправити клоузеру. Спробуйте пізніше.', {
          reply_markup: keyboard
        });
      }
      return;
    }

    // Перевіряємо, чи очікується передача ліда від цього користувача
    const awaitingActionLead = await getAwaitingAction(chat_id);
    if (awaitingActionLead === 'lead') {
      // Перевіряємо, чи це воркер
      const { data: worker } = await supabase
        .from('analytics-users')
        .select('ref_id, username, first_name')
        .eq('chat_id', chat_id)
        .single();

      if (!worker || !worker.ref_id) {
        await setAwaitingAction(chat_id, null);
        await ctx.reply('❌ Ви не прив\'язані до клоузера.');
        return;
      }

      // Отримуємо текст повідомлення
      let leadText = '';
      if ('text' in message && message.text) {
        leadText = message.text;
      } else if ('caption' in message && message.caption) {
        leadText = message.caption;
      } else {
        await ctx.reply('❌ Будь ласка, надішліть текст з інформацією про ліда.');
        return;
      }

      // Парсимо інформацію про ліда (спробуємо витягти структуровані дані)
      let leadName = '';
      let leadContact = '';
      let leadInfo = leadText;

      // Спроба парсингу структурованого формату
      const nameMatch = leadText.match(/ім['\']я[:\s]+(.+)/i) || leadText.match(/ім['\']я[:\s]+(.+)/i) || leadText.match(/name[:\s]+(.+)/i);
      const contactMatch = leadText.match(/контакт[:\s]+(.+)/i) || leadText.match(/contact[:\s]+(.+)/i) || leadText.match(/телефон[:\s]+(.+)/i) || leadText.match(/phone[:\s]+(.+)/i);
      const infoMatch = leadText.match(/інформація[:\s]+(.+)/i) || leadText.match(/info[:\s]+(.+)/i);

      if (nameMatch) {
        leadName = nameMatch[1].split('\n')[0].trim();
        leadInfo = leadText.replace(nameMatch[0], '').trim();
      }
      if (contactMatch) {
        leadContact = contactMatch[1].split('\n')[0].trim();
        leadInfo = leadInfo.replace(contactMatch[0], '').trim();
      }
      if (infoMatch) {
        leadInfo = infoMatch[1].trim();
      }

      // Якщо не знайдено структуровані дані, використовуємо весь текст як інформацію
      if (!leadName && !leadContact) {
        leadInfo = leadText;
      }

      // Зберігаємо ліда в базу
      const leadData = {
        worker_chat_id: chat_id,
        closer_chat_id: worker.ref_id,
        lead_name: leadName || null,
        lead_contact: leadContact || null,
        lead_info: leadInfo,
        lead_status: 'new',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      console.log('Attempting to save lead:', JSON.stringify(leadData, null, 2));

      const { data: lead, error: insertError } = await supabase
        .from('worker_leads')
        .insert(leadData)
        .select()
        .single();

      if (insertError) {
        console.error('Error saving lead:', insertError);
        console.error('Error details:', JSON.stringify(insertError, null, 2));
        await ctx.reply(`❌ Помилка при збереженні ліда: ${insertError.message || 'Unknown error'}`);
        return;
      }

      if (!lead) {
        console.error('Lead was not returned after insert');
        await ctx.reply('❌ Помилка: лід не було збережено.');
        return;
      }

      console.log('Lead saved successfully:', lead.id);

      // Видаляємо прапорець очікування
      await setAwaitingAction(chat_id, null);

      // Відправляємо інформацію про ліда клоузеру
      const workerName = `@${worker.username || worker.first_name || 'Unknown'}`;
      const leadDate = new Date(lead.created_at).toLocaleString('uk-UA');
      
      let closerMessage = `👤 Новий лід від воркера ${workerName}\n📅 ${leadDate}\n\n`;
      
      if (leadName) {
        closerMessage += `👤 Ім'я: ${leadName}\n`;
      }
      if (leadContact) {
        closerMessage += `📞 Контакт: ${leadContact}\n`;
      }
      closerMessage += `\n📝 Інформація:\n${leadInfo}`;

      // Створюємо inline клавіатуру з кнопками для клоузера
      const leadKeyboard = new InlineKeyboard()
        .text('✅ Взяти в обробку', `take_lead_${lead.id}`)
        .text('❌ Відмовитися', `reject_lead_${lead.id}`);

      await bot.api.sendMessage(worker.ref_id, closerMessage, {
        reply_markup: leadKeyboard
      });

      // Підтвердження воркеру
      const keyboard = await getKeyboardForUser(chat_id);

      await ctx.reply('✅ Лід успішно передано клоузеру!', {
        reply_markup: keyboard
      });
      return;
    }

    // Перевіряємо, чи очікується звіт від клоузера
    const awaitingActionCloser = await getAwaitingAction(chat_id);
    if (awaitingActionCloser === 'closer_report') {
      // Перевіряємо, чи це клоузер
      const { data: closer } = await supabase
        .from('analytics-users')
        .select('role, username, first_name')
        .eq('chat_id', chat_id)
        .single();

      if (!closer || closer.role !== 'closer') {
        await setAwaitingAction(chat_id, null);
        await ctx.reply('❌ Ця функція доступна тільки для клоузерів.');
        return;
      }

      // Витягуємо дані повідомлення
      let messageText = '';
      let messageType = 'text';
      let fileId = null;

      if ('text' in message && message.text) {
        messageText = message.text;
        messageType = 'text';
      } else if ('photo' in message && message.photo && message.photo.length > 0) {
        messageText = message.caption || '';
        messageType = 'photo';
        fileId = message.photo[message.photo.length - 1].file_id;
      } else if ('document' in message && message.document) {
        messageText = message.caption || message.document.file_name || '';
        messageType = 'document';
        fileId = message.document.file_id;
      } else if ('video' in message && message.video) {
        messageText = message.caption || '';
        messageType = 'video';
        fileId = message.video.file_id;
      } else {
        await ctx.reply('❌ Підтримуються тільки текст, фото, документи та відео.');
        return;
      }

      // Зберігаємо звіт клоузера в базу
      const reportData = {
        closer_chat_id: chat_id,
        message_text: messageText,
        message_type: messageType,
        file_id: fileId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      console.log('Attempting to save closer report:', JSON.stringify(reportData, null, 2));
      console.log('Supabase client initialized:', !!supabase);
      console.log('Table: closer_reports');

      const { data: report, error: insertError } = await supabase
        .from('closer_reports')
        .insert(reportData)
        .select()
        .single();

      if (insertError) {
        console.error('Error saving closer report:', insertError);
        console.error('Error code:', insertError.code);
        console.error('Error message:', insertError.message);
        console.error('Error details:', JSON.stringify(insertError, null, 2));
        console.error('Error hint:', insertError.hint);
        await ctx.reply(`❌ Помилка при збереженні звіту: ${insertError.message || insertError.code || 'Unknown error'}`);
        return;
      }

      if (!report) {
        console.error('Closer report was not returned after insert - data is null');
        await ctx.reply('❌ Помилка: звіт не було збережено (дані не повернуто).');
        return;
      }

      console.log('Closer report saved successfully. Report ID:', report.id);
      console.log('Saved report data:', JSON.stringify(report, null, 2));

      // Видаляємо прапорець очікування
      await setAwaitingAction(chat_id, null);

      // Підтвердження клоузеру
      const keyboard = await getKeyboardForUser(chat_id);

      await ctx.reply('✅ Звіт успішно збережено!', {
        reply_markup: keyboard
      });
      return;
    }

    // Якщо не очікується ні звіт, ні ліда, ні звіт клоузера, не обробляємо повідомлення
  } catch (error) {
    console.error('Error processing message:', error);
    const chat_id = ctx.message.chat.id;
    await setAwaitingAction(chat_id, null);
    await ctx.reply('❌ Помилка при обробці повідомлення.');
  }
});

// Перегляд звітів конкретного воркера
bot.callbackQuery(/^worker_reports_(\d+)$/, async (ctx) => {
  try {
    await ctx.answerCallbackQuery();
    const chat_id = ctx.callbackQuery.message?.chat.id;
    const match = ctx.match;
    
    if (!chat_id || !match) {
      await ctx.reply('❌ Помилка отримання даних.');
      return;
    }

    const workerChatId = parseInt(match[1]);
    
    // Перевіряємо, чи це клоузер і чи воркер належить йому
    const { data: closer } = await supabase
      .from('analytics-users')
      .select('role')
      .eq('chat_id', chat_id)
      .single();

    if (!closer || closer.role !== 'closer') {
      const keyboard = await getKeyboardForUser(chat_id);
      await ctx.reply('❌ Ця функція доступна тільки для клоузерів.', { reply_markup: keyboard });
      return;
    }

    const { data: worker } = await supabase
      .from('analytics-users')
      .select('chat_id, username, first_name, ref_id')
      .eq('chat_id', workerChatId)
      .single();

    if (!worker || worker.ref_id !== chat_id) {
      const keyboard = await getKeyboardForUser(chat_id);
      await ctx.reply('❌ Воркер не знайдено або не належить вам.', { reply_markup: keyboard });
      return;
    }

    // Отримуємо всі звіти цього воркера
    const { data: reports, error: reportsError } = await supabase
      .from('worker_reports')
      .select('*')
      .eq('worker_chat_id', workerChatId)
      .eq('closer_chat_id', chat_id)
      .order('created_at', { ascending: false })
      .limit(50); // Обмежуємо до 50 останніх звітів

    if (reportsError) {
      console.error('[WORKER_REPORTS] Error fetching reports:', reportsError);
      const keyboard = await getKeyboardForUser(chat_id);
      await ctx.reply('❌ Помилка при отриманні звітів.', { reply_markup: keyboard });
      return;
    }

    if (!reports || reports.length === 0) {
      const keyboard = await getKeyboardForUser(chat_id);
      const workerName = `@${worker.username || worker.first_name || 'Unknown'}`;
      await ctx.reply(`📋 У воркера ${workerName} поки немає звітів.`, { reply_markup: keyboard });
      return;
    }

    // Форматуємо звіти
    const workerName = `@${worker.username || worker.first_name || 'Unknown'}`;
    let reportsText = `📋 Звіти воркера ${workerName} (${reports.length}):\n\n`;
    
    reports.forEach((report: any, idx: number) => {
      const reportDate = new Date(report.created_at).toLocaleString('uk-UA');
      const status = report.status === 'read' ? '✅ Прочитано' : '📬 Непрочитано';
      
      reportsText += `${idx + 1}. ${status}\n`;
      reportsText += `   📅 ${reportDate}\n`;
      
      if (report.message_type === 'photo') {
        reportsText += `   📷 Фото: ${report.message_text || '(без підпису)'}\n`;
      } else if (report.message_type === 'document') {
        reportsText += `   📄 Документ: ${report.message_text || '(без опису)'}\n`;
      } else if (report.message_type === 'video') {
        reportsText += `   🎥 Відео: ${report.message_text || '(без підпису)'}\n`;
      } else {
        reportsText += `   💬 ${report.message_text}\n`;
      }
      
      reportsText += '\n';
    });

    const keyboard = await getKeyboardForUser(chat_id);
    await ctx.reply(reportsText, { reply_markup: keyboard });
  } catch (error) {
    console.error('Error in worker_reports callback:', error);
    await ctx.reply('❌ Помилка при отриманні звітів.');
  }
});

// Перегляд лідов конкретного воркера
bot.callbackQuery(/^worker_leads_(\d+)$/, async (ctx) => {
  try {
    await ctx.answerCallbackQuery();
    const chat_id = ctx.callbackQuery.message?.chat.id;
    const match = ctx.match;
    
    if (!chat_id || !match) {
      await ctx.reply('❌ Помилка отримання даних.');
      return;
    }

    const workerChatId = parseInt(match[1]);
    
    // Перевіряємо, чи це клоузер і чи воркер належить йому
    const { data: closer } = await supabase
      .from('analytics-users')
      .select('role')
      .eq('chat_id', chat_id)
      .single();

    if (!closer || closer.role !== 'closer') {
      const keyboard = await getKeyboardForUser(chat_id);
      await ctx.reply('❌ Ця функція доступна тільки для клоузерів.', { reply_markup: keyboard });
      return;
    }

    const { data: worker } = await supabase
      .from('analytics-users')
      .select('chat_id, username, first_name, ref_id')
      .eq('chat_id', workerChatId)
      .single();

    if (!worker || worker.ref_id !== chat_id) {
      const keyboard = await getKeyboardForUser(chat_id);
      await ctx.reply('❌ Воркер не знайдено або не належить вам.', { reply_markup: keyboard });
      return;
    }

    // Отримуємо всі ліди цього воркера
    const { data: leads, error: leadsError } = await supabase
      .from('worker_leads')
      .select('*')
      .eq('worker_chat_id', workerChatId)
      .eq('closer_chat_id', chat_id)
      .order('created_at', { ascending: false })
      .limit(50); // Обмежуємо до 50 останніх лідов

    if (leadsError) {
      console.error('[WORKER_LEADS] Error fetching leads:', leadsError);
      const keyboard = await getKeyboardForUser(chat_id);
      await ctx.reply('❌ Помилка при отриманні лідов.', { reply_markup: keyboard });
      return;
    }

    if (!leads || leads.length === 0) {
      const keyboard = await getKeyboardForUser(chat_id);
      const workerName = `@${worker.username || worker.first_name || 'Unknown'}`;
      await ctx.reply(`👤 У воркера ${workerName} поки немає лідов.`, { reply_markup: keyboard });
      return;
    }

    // Групуємо ліди за статусом
    const leadsByStatus: {
      new: any[];
      contacted: any[];
      converted: any[];
      lost: any[];
      rejected: any[];
      closed: any[];
    } = {
      new: leads.filter((l: any) => l.lead_status === 'new'),
      contacted: leads.filter((l: any) => l.lead_status === 'contacted'),
      converted: leads.filter((l: any) => l.lead_status === 'converted'),
      lost: leads.filter((l: any) => l.lead_status === 'lost'),
      rejected: leads.filter((l: any) => l.lead_status === 'rejected'),
      closed: leads.filter((l: any) => l.lead_status === 'closed')
    };

    // Форматуємо ліди
    const workerName = `@${worker.username || worker.first_name || 'Unknown'}`;
    const MAX_MESSAGE_LENGTH = 4000; // Залишаємо запас для Telegram (ліміт 4096)
    let leadsText = `👤 Ліди воркера ${workerName} (всього: ${leads.length}):\n\n`;
    const leadsKeyboard = new InlineKeyboard();
    
    // Функція для форматування ліда з обмеженням довжини
    const formatLead = (lead: any, idx: number): { text: string; length: number; hasFullInfo: boolean } => {
      const leadDate = new Date(lead.created_at).toLocaleString('uk-UA');
      let leadText = `\n${idx + 1}. 📅 ${leadDate}\n`;
      let hasFullInfo = false;
      
      if (lead.lead_name) {
        leadText += `   👤 Ім'я: ${lead.lead_name}\n`;
      }
      if (lead.lead_contact) {
        leadText += `   📞 Контакт: ${lead.lead_contact}\n`;
      }
      if (lead.lead_info) {
        // Обмежуємо довжину інформації про ліда до 100 символів
        const maxInfoLength = 100;
        if (lead.lead_info.length > maxInfoLength) {
          const info = lead.lead_info.substring(0, maxInfoLength) + '...';
          leadText += `   📝 Інформація: ${info}\n`;
          hasFullInfo = true;
        } else {
          leadText += `   📝 Інформація: ${lead.lead_info}\n`;
        }
      }
      
      return { text: leadText, length: leadText.length, hasFullInfo };
    };
    
    let currentLength = leadsText.length;
    let totalDisplayed = 0;
    
    // Нові ліди
    if (leadsByStatus.new.length > 0) {
      leadsText += `🆕 Нові (${leadsByStatus.new.length}):\n`;
      currentLength += `🆕 Нові (${leadsByStatus.new.length}):\n`.length;
      
      for (let idx = 0; idx < leadsByStatus.new.length; idx++) {
        const lead = leadsByStatus.new[idx];
        const formatted = formatLead(lead, idx + 1);
        
        if (currentLength + formatted.length > MAX_MESSAGE_LENGTH) {
          break;
        }
        
        leadsText += formatted.text;
        currentLength += formatted.length;
        totalDisplayed++;
        
        // Додаємо кнопку для перегляду повної інформації, якщо інформація обрізана
        if (formatted.hasFullInfo) {
          leadsKeyboard.text(`📄 Лід #${lead.id}`, `view_full_lead_${lead.id}`).row();
        }
      }
      leadsText += '\n';
      currentLength += 1;
    }

    // Зв'язався
    if (leadsByStatus.contacted.length > 0 && currentLength < MAX_MESSAGE_LENGTH) {
      const header = `📞 Зв'язався (${leadsByStatus.contacted.length}):\n`;
      if (currentLength + header.length < MAX_MESSAGE_LENGTH) {
        leadsText += header;
        currentLength += header.length;
        
        for (let idx = 0; idx < leadsByStatus.contacted.length; idx++) {
          const lead = leadsByStatus.contacted[idx];
          const formatted = formatLead(lead, idx + 1);
          
          if (currentLength + formatted.length > MAX_MESSAGE_LENGTH) {
            break;
          }
          
          leadsText += formatted.text;
          currentLength += formatted.length;
          totalDisplayed++;
          
          // Додаємо кнопку для перегляду повної інформації, якщо інформація обрізана
          if (formatted.hasFullInfo) {
            leadsKeyboard.text(`📄 Лід #${lead.id}`, `view_full_lead_${lead.id}`).row();
          }
        }
        leadsText += '\n';
        currentLength += 1;
      }
    }

    // Конвертувався
    if (leadsByStatus.converted.length > 0 && currentLength < MAX_MESSAGE_LENGTH) {
      const header = `✅ Конвертувався (${leadsByStatus.converted.length}):\n`;
      if (currentLength + header.length < MAX_MESSAGE_LENGTH) {
        leadsText += header;
        currentLength += header.length;
        
        for (let idx = 0; idx < leadsByStatus.converted.length; idx++) {
          const lead = leadsByStatus.converted[idx];
          const formatted = formatLead(lead, idx + 1);
          
          if (currentLength + formatted.length > MAX_MESSAGE_LENGTH) {
            break;
          }
          
          leadsText += formatted.text;
          currentLength += formatted.length;
          totalDisplayed++;
          
          // Додаємо кнопку для перегляду повної інформації, якщо інформація обрізана
          if (formatted.hasFullInfo) {
            leadsKeyboard.text(`📄 Лід #${lead.id}`, `view_full_lead_${lead.id}`).row();
          }
        }
        leadsText += '\n';
        currentLength += 1;
      }
    }

    // Втрачений
    if (leadsByStatus.lost.length > 0 && currentLength < MAX_MESSAGE_LENGTH) {
      const header = `❌ Втрачений (${leadsByStatus.lost.length}):\n`;
      if (currentLength + header.length < MAX_MESSAGE_LENGTH) {
        leadsText += header;
        currentLength += header.length;
        
        for (let idx = 0; idx < leadsByStatus.lost.length; idx++) {
          const lead = leadsByStatus.lost[idx];
          const formatted = formatLead(lead, idx + 1);
          
          if (currentLength + formatted.length > MAX_MESSAGE_LENGTH) {
            break;
          }
          
          leadsText += formatted.text;
          currentLength += formatted.length;
          totalDisplayed++;
          
          // Додаємо кнопку для перегляду повної інформації, якщо інформація обрізана
          if (formatted.hasFullInfo) {
            leadsKeyboard.text(`📄 Лід #${lead.id}`, `view_full_lead_${lead.id}`).row();
          }
        }
      }
    }

    // Відмовлені
    if (leadsByStatus.rejected.length > 0 && currentLength < MAX_MESSAGE_LENGTH) {
      const header = `🚫 Відмовлені (${leadsByStatus.rejected.length}):\n`;
      if (currentLength + header.length < MAX_MESSAGE_LENGTH) {
        leadsText += header;
        currentLength += header.length;
        
        for (let idx = 0; idx < leadsByStatus.rejected.length; idx++) {
          const lead = leadsByStatus.rejected[idx];
          const formatted = formatLead(lead, idx + 1);
          
          if (currentLength + formatted.length > MAX_MESSAGE_LENGTH) {
            break;
          }
          
          leadsText += formatted.text;
          currentLength += formatted.length;
          totalDisplayed++;
          
          // Додаємо кнопку для перегляду повної інформації, якщо інформація обрізана
          if (formatted.hasFullInfo) {
            leadsKeyboard.text(`📄 Лід #${lead.id}`, `view_full_lead_${lead.id}`).row();
          }
        }
        leadsText += '\n';
        currentLength += 1;
      }
    }

    // Закриті
    if (leadsByStatus.closed.length > 0 && currentLength < MAX_MESSAGE_LENGTH) {
      const header = `🔒 Закриті (${leadsByStatus.closed.length}):\n`;
      if (currentLength + header.length < MAX_MESSAGE_LENGTH) {
        leadsText += header;
        currentLength += header.length;
        
        for (let idx = 0; idx < leadsByStatus.closed.length; idx++) {
          const lead = leadsByStatus.closed[idx];
          const formatted = formatLead(lead, idx + 1);
          
          if (currentLength + formatted.length > MAX_MESSAGE_LENGTH) {
            break;
          }
          
          leadsText += formatted.text;
          currentLength += formatted.length;
          totalDisplayed++;
          
          // Додаємо кнопку для перегляду повної інформації, якщо інформація обрізана
          if (formatted.hasFullInfo) {
            leadsKeyboard.text(`📄 Лід #${lead.id}`, `view_full_lead_${lead.id}`).row();
          }
        }
      }
    }

    // Якщо не всі ліди відображені, додаємо інформацію
    if (totalDisplayed < leads.length) {
      leadsText += `\n\n⚠️ Показано ${totalDisplayed} з ${leads.length} лідов (повідомлення обрізано через обмеження Telegram)`;
    }

    const keyboard = await getKeyboardForUser(chat_id);
    // Якщо є кнопки для перегляду повної інформації, показуємо їх
    if (leadsKeyboard.inline_keyboard.length > 0) {
      await ctx.reply(leadsText, { reply_markup: leadsKeyboard });
    } else {
      await ctx.reply(leadsText, { reply_markup: keyboard });
    }
  } catch (error) {
    console.error('Error in worker_leads callback:', error);
    await ctx.reply('❌ Помилка при отриманні лідов.');
  }
});

// Перегляд активних лідов конкретного воркера
bot.callbackQuery(/^worker_active_leads_(\d+)$/, async (ctx) => {
  try {
    await ctx.answerCallbackQuery();
    const chat_id = ctx.callbackQuery.message?.chat.id;
    const match = ctx.match;
    
    if (!chat_id || !match) {
      await ctx.reply('❌ Помилка отримання даних.');
      return;
    }

    const workerChatId = parseInt(match[1]);
    
    // Перевіряємо, чи це клоузер і чи воркер належить йому
    const { data: closer } = await supabase
      .from('analytics-users')
      .select('role')
      .eq('chat_id', chat_id)
      .single();

    if (!closer || closer.role !== 'closer') {
      const keyboard = await getKeyboardForUser(chat_id);
      await ctx.reply('❌ Ця функція доступна тільки для клоузерів.', { reply_markup: keyboard });
      return;
    }

    const { data: worker } = await supabase
      .from('analytics-users')
      .select('chat_id, username, first_name, ref_id')
      .eq('chat_id', workerChatId)
      .single();

    if (!worker || worker.ref_id !== chat_id) {
      const keyboard = await getKeyboardForUser(chat_id);
      await ctx.reply('❌ Воркер не знайдено або не належить вам.', { reply_markup: keyboard });
      return;
    }

    // Отримуємо активні ліди (new + contacted)
    console.log('[WORKER_ACTIVE_LEADS] Fetching active leads for worker_chat_id:', workerChatId, 'closer_chat_id:', chat_id);
    const { data: leads, error: leadsError } = await supabase
      .from('worker_leads')
      .select('*')
      .eq('worker_chat_id', workerChatId)
      .eq('closer_chat_id', chat_id)
      .in('lead_status', ['new', 'contacted'])
      .order('created_at', { ascending: false });

    console.log('[WORKER_ACTIVE_LEADS] Query result - data:', leads ? `Found ${leads.length} leads` : 'null');
    console.log('[WORKER_ACTIVE_LEADS] Query result - error:', leadsError ? JSON.stringify(leadsError, null, 2) : 'null');

    if (leadsError) {
      console.error('[WORKER_ACTIVE_LEADS] ===== ERROR FETCHING LEADS =====');
      console.error('[WORKER_ACTIVE_LEADS] Error object:', JSON.stringify(leadsError, null, 2));
      console.error('[WORKER_ACTIVE_LEADS] Error code:', leadsError.code);
      console.error('[WORKER_ACTIVE_LEADS] Error message:', leadsError.message);
      console.error('[WORKER_ACTIVE_LEADS] Error details:', leadsError.details);
      console.error('[WORKER_ACTIVE_LEADS] Error hint:', leadsError.hint);
      const keyboard = await getKeyboardForUser(chat_id);
      await ctx.reply(`❌ Помилка при отриманні активних лідов.\n\nДеталі: ${leadsError.message || leadsError.code || 'Unknown error'}`, { reply_markup: keyboard });
      return;
    }

    if (!leads || leads.length === 0) {
      const keyboard = await getKeyboardForUser(chat_id);
      const workerName = `@${worker.username || worker.first_name || 'Unknown'}`;
      await ctx.reply(`✅ У воркера ${workerName} немає активних лідов.`, { reply_markup: keyboard });
      return;
    }

    // Форматуємо ліди з обмеженням до 100 символів інформації та кнопками
    const workerName = `@${worker.username || worker.first_name || 'Unknown'}`;
    const MAX_MESSAGE_LENGTH = 4000;
    let leadsText = `✅ Активні ліди воркера ${workerName} (${leads.length}):\n\n`;
    const leadsKeyboard = new InlineKeyboard();
    
    let currentLength = leadsText.length;
    let displayedCount = 0;
    
    for (let idx = 0; idx < leads.length; idx++) {
      const lead = leads[idx];
      const leadDate = new Date(lead.created_at).toLocaleString('uk-UA');
      const status = lead.lead_status === 'new' ? '🆕 Новий' : '📞 В обробці';
      
      let leadText = `${idx + 1}. ${status}\n`;
      leadText += `   📅 ${leadDate}\n`;
      if (lead.lead_name) {
        leadText += `   👤 Ім'я: ${lead.lead_name}\n`;
      }
      if (lead.lead_contact) {
        leadText += `   📞 Контакт: ${lead.lead_contact}\n`;
      }
      if (lead.lead_info) {
        // Обмежуємо довжину інформації до 100 символів
        const maxInfoLength = 100;
        let hasFullInfo = false;
        let info = lead.lead_info;
        if (lead.lead_info.length > maxInfoLength) {
          info = lead.lead_info.substring(0, maxInfoLength) + '...';
          hasFullInfo = true;
        }
        leadText += `   📝 Інформація: ${info}\n`;
        
        // Додаємо кнопку для перегляду повної інформації, якщо інформація обрізана
        if (hasFullInfo) {
          leadsKeyboard.text(`📄 Лід #${lead.id}`, `view_full_lead_${lead.id}`).row();
        }
      }
      leadText += '\n';
      
      // Перевіряємо, чи не перевищимо ліміт
      if (currentLength + leadText.length > MAX_MESSAGE_LENGTH) {
        break;
      }
      
      leadsText += leadText;
      currentLength += leadText.length;
      displayedCount++;
      
      // Додаємо кнопки для зміни статусу ліда
      leadsKeyboard
        .text(`🔒 Закрити #${lead.id}`, `close_lead_${lead.id}`)
        .text(`🚫 Відмовитися #${lead.id}`, `reject_lead_from_list_${lead.id}`).row();
    }
    
    // Якщо не всі ліди відображені, додаємо інформацію
    if (displayedCount < leads.length) {
      leadsText += `\n... та ще ${leads.length - displayedCount} лідов (повідомлення обрізано через обмеження Telegram)`;
    }

    const keyboard = await getKeyboardForUser(chat_id);
    // Якщо є кнопки, показуємо їх
    if (leadsKeyboard.inline_keyboard.length > 0) {
      await ctx.reply(leadsText, { reply_markup: leadsKeyboard });
    } else {
      await ctx.reply(leadsText, { reply_markup: keyboard });
    }
  } catch (error) {
    console.error('[WORKER_ACTIVE_LEADS] ===== ERROR IN CALLBACK =====');
    console.error('[WORKER_ACTIVE_LEADS] Error:', error);
    console.error('[WORKER_ACTIVE_LEADS] Error type:', error instanceof Error ? error.constructor.name : typeof error);
    console.error('[WORKER_ACTIVE_LEADS] Error message:', error instanceof Error ? error.message : String(error));
    console.error('[WORKER_ACTIVE_LEADS] Error stack:', error instanceof Error ? error.stack : 'No stack');
    const errorChatId = ctx.callbackQuery.message?.chat.id;
    if (errorChatId) {
      const keyboard = await getKeyboardForUser(errorChatId);
      await ctx.reply(`❌ Помилка при отриманні активних лідов.\n\nДеталі: ${error instanceof Error ? error.message : String(error)}`, { reply_markup: keyboard });
    } else {
      await ctx.reply(`❌ Помилка при отриманні активних лідов.\n\nДеталі: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
});

// Перегляд відмовлених лідов конкретного воркера
bot.callbackQuery(/^worker_rejected_leads_(\d+)$/, async (ctx) => {
  try {
    await ctx.answerCallbackQuery();
    const chat_id = ctx.callbackQuery.message?.chat.id;
    const match = ctx.match;
    
    if (!chat_id || !match) {
      await ctx.reply('❌ Помилка отримання даних.');
      return;
    }

    const workerChatId = parseInt(match[1]);
    
    // Перевіряємо, чи це клоузер і чи воркер належить йому
    const { data: closer } = await supabase
      .from('analytics-users')
      .select('role')
      .eq('chat_id', chat_id)
      .single();

    if (!closer || closer.role !== 'closer') {
      const keyboard = await getKeyboardForUser(chat_id);
      await ctx.reply('❌ Ця функція доступна тільки для клоузерів.', { reply_markup: keyboard });
      return;
    }

    const { data: worker } = await supabase
      .from('analytics-users')
      .select('chat_id, username, first_name, ref_id')
      .eq('chat_id', workerChatId)
      .single();

    if (!worker || worker.ref_id !== chat_id) {
      const keyboard = await getKeyboardForUser(chat_id);
      await ctx.reply('❌ Воркер не знайдено або не належить вам.', { reply_markup: keyboard });
      return;
    }

    // Отримуємо відмовлені ліди
    console.log('[WORKER_REJECTED_LEADS] Fetching rejected leads for worker_chat_id:', workerChatId, 'closer_chat_id:', chat_id);
    const { data: leads, error: leadsError } = await supabase
      .from('worker_leads')
      .select('*')
      .eq('worker_chat_id', workerChatId)
      .eq('closer_chat_id', chat_id)
      .eq('lead_status', 'rejected')
      .order('created_at', { ascending: false });

    console.log('[WORKER_REJECTED_LEADS] Query result - data:', leads ? `Found ${leads.length} leads` : 'null');
    console.log('[WORKER_REJECTED_LEADS] Query result - error:', leadsError ? JSON.stringify(leadsError, null, 2) : 'null');

    if (leadsError) {
      console.error('[WORKER_REJECTED_LEADS] ===== ERROR FETCHING LEADS =====');
      console.error('[WORKER_REJECTED_LEADS] Error object:', JSON.stringify(leadsError, null, 2));
      console.error('[WORKER_REJECTED_LEADS] Error code:', leadsError.code);
      console.error('[WORKER_REJECTED_LEADS] Error message:', leadsError.message);
      const keyboard = await getKeyboardForUser(chat_id);
      await ctx.reply(`❌ Помилка при отриманні відмовлених лідов.\n\nДеталі: ${leadsError.message || leadsError.code || 'Unknown error'}`, { reply_markup: keyboard });
      return;
    }

    if (!leads || leads.length === 0) {
      const keyboard = await getKeyboardForUser(chat_id);
      const workerName = `@${worker.username || worker.first_name || 'Unknown'}`;
      await ctx.reply(`❌ У воркера ${workerName} немає відмовлених лідов.`, { reply_markup: keyboard });
      return;
    }

    // Форматуємо ліди з обмеженням до 100 символів інформації
    const workerName = `@${worker.username || worker.first_name || 'Unknown'}`;
    const MAX_MESSAGE_LENGTH = 4000; // Залишаємо запас для Telegram (ліміт 4096)
    
    let leadsText = `❌ Відмовлені ліди воркера ${workerName} (${leads.length}):\n\n`;
    const leadsKeyboard = new InlineKeyboard();
    let currentLength = leadsText.length;
    let displayedCount = 0;
    
    for (let idx = 0; idx < leads.length; idx++) {
      const lead = leads[idx];
      const leadDate = new Date(lead.created_at).toLocaleString('uk-UA');
      
      let leadText = `${idx + 1}. 📅 ${leadDate}\n`;
      if (lead.lead_name) {
        leadText += `   👤 Ім'я: ${lead.lead_name}\n`;
      }
      if (lead.lead_contact) {
        leadText += `   📞 Контакт: ${lead.lead_contact}\n`;
      }
      if (lead.lead_info) {
        // Обмежуємо довжину інформації до 100 символів
        const maxInfoLength = 100;
        let hasFullInfo = false;
        let info = lead.lead_info;
        if (lead.lead_info.length > maxInfoLength) {
          info = lead.lead_info.substring(0, maxInfoLength) + '...';
          hasFullInfo = true;
        }
        leadText += `   📝 Інформація: ${info}\n`;
        
        // Додаємо кнопку для перегляду повної інформації, якщо інформація обрізана
        if (hasFullInfo) {
          leadsKeyboard.text(`📄 Лід #${lead.id}`, `view_full_lead_${lead.id}`).row();
        }
      }
      leadText += '\n';
      
      // Перевіряємо, чи не перевищимо ліміт
      if (currentLength + leadText.length > MAX_MESSAGE_LENGTH) {
        break;
      }
      
      leadsText += leadText;
      currentLength += leadText.length;
      displayedCount++;
    }
    
    // Якщо не всі ліди відображені, додаємо інформацію
    if (displayedCount < leads.length) {
      leadsText += `\n... та ще ${leads.length - displayedCount} лідов (повідомлення обрізано через обмеження Telegram)`;
    }

    const keyboard = await getKeyboardForUser(chat_id);
    // Якщо є кнопки для перегляду повної інформації, показуємо їх
    if (leadsKeyboard.inline_keyboard.length > 0) {
      await ctx.reply(leadsText, { reply_markup: leadsKeyboard });
    } else {
      await ctx.reply(leadsText, { reply_markup: keyboard });
    }
  } catch (error) {
    console.error('Error in worker_rejected_leads callback:', error);
    await ctx.reply('❌ Помилка при отриманні відмовлених лідов.');
  }
});

// Перегляд закритих лідов конкретного воркера
bot.callbackQuery(/^worker_closed_leads_(\d+)$/, async (ctx) => {
  try {
    await ctx.answerCallbackQuery();
    const chat_id = ctx.callbackQuery.message?.chat.id;
    const match = ctx.match;
    
    if (!chat_id || !match) {
      await ctx.reply('❌ Помилка отримання даних.');
      return;
    }

    const workerChatId = parseInt(match[1]);
    
    // Перевіряємо, чи це клоузер і чи воркер належить йому
    const { data: closer } = await supabase
      .from('analytics-users')
      .select('role')
      .eq('chat_id', chat_id)
      .single();

    if (!closer || closer.role !== 'closer') {
      const keyboard = await getKeyboardForUser(chat_id);
      await ctx.reply('❌ Ця функція доступна тільки для клоузерів.', { reply_markup: keyboard });
      return;
    }

    const { data: worker } = await supabase
      .from('analytics-users')
      .select('chat_id, username, first_name, ref_id')
      .eq('chat_id', workerChatId)
      .single();

    if (!worker || worker.ref_id !== chat_id) {
      const keyboard = await getKeyboardForUser(chat_id);
      await ctx.reply('❌ Воркер не знайдено або не належить вам.', { reply_markup: keyboard });
      return;
    }

    // Отримуємо закриті ліди
    console.log('[WORKER_CLOSED_LEADS] Fetching closed leads for worker_chat_id:', workerChatId, 'closer_chat_id:', chat_id);
    const { data: leads, error: leadsError } = await supabase
      .from('worker_leads')
      .select('*')
      .eq('worker_chat_id', workerChatId)
      .eq('closer_chat_id', chat_id)
      .eq('lead_status', 'closed')
      .order('created_at', { ascending: false });

    console.log('[WORKER_CLOSED_LEADS] Query result - data:', leads ? `Found ${leads.length} leads` : 'null');
    console.log('[WORKER_CLOSED_LEADS] Query result - error:', leadsError ? JSON.stringify(leadsError, null, 2) : 'null');

    if (leadsError) {
      console.error('[WORKER_CLOSED_LEADS] ===== ERROR FETCHING LEADS =====');
      console.error('[WORKER_CLOSED_LEADS] Error object:', JSON.stringify(leadsError, null, 2));
      console.error('[WORKER_CLOSED_LEADS] Error code:', leadsError.code);
      console.error('[WORKER_CLOSED_LEADS] Error message:', leadsError.message);
      const keyboard = await getKeyboardForUser(chat_id);
      await ctx.reply(`❌ Помилка при отриманні закритих лідов.\n\nДеталі: ${leadsError.message || leadsError.code || 'Unknown error'}`, { reply_markup: keyboard });
      return;
    }

    if (!leads || leads.length === 0) {
      const keyboard = await getKeyboardForUser(chat_id);
      const workerName = `@${worker.username || worker.first_name || 'Unknown'}`;
      await ctx.reply(`🔒 У воркера ${workerName} немає закритих лідов.`, { reply_markup: keyboard });
      return;
    }

    // Форматуємо ліди з обмеженням до 100 символів інформації
    const workerName = `@${worker.username || worker.first_name || 'Unknown'}`;
    const MAX_MESSAGE_LENGTH = 4000; // Залишаємо запас для Telegram (ліміт 4096)
    
    let leadsText = `🔒 Закриті ліди воркера ${workerName} (${leads.length}):\n\n`;
    const leadsKeyboard = new InlineKeyboard();
    let currentLength = leadsText.length;
    let displayedCount = 0;
    
    for (let idx = 0; idx < leads.length; idx++) {
      const lead = leads[idx];
      const leadDate = new Date(lead.created_at).toLocaleString('uk-UA');
      
      let leadText = `${idx + 1}. 📅 ${leadDate}\n`;
      if (lead.lead_name) {
        leadText += `   👤 Ім'я: ${lead.lead_name}\n`;
      }
      if (lead.lead_contact) {
        leadText += `   📞 Контакт: ${lead.lead_contact}\n`;
      }
      if (lead.lead_info) {
        // Обмежуємо довжину інформації до 100 символів
        const maxInfoLength = 100;
        let hasFullInfo = false;
        let info = lead.lead_info;
        if (lead.lead_info.length > maxInfoLength) {
          info = lead.lead_info.substring(0, maxInfoLength) + '...';
          hasFullInfo = true;
        }
        leadText += `   📝 Інформація: ${info}\n`;
        
        // Додаємо кнопку для перегляду повної інформації, якщо інформація обрізана
        if (hasFullInfo) {
          leadsKeyboard.text(`📄 Лід #${lead.id}`, `view_full_lead_${lead.id}`).row();
        }
      }
      leadText += '\n';
      
      // Перевіряємо, чи не перевищимо ліміт
      if (currentLength + leadText.length > MAX_MESSAGE_LENGTH) {
        break;
      }
      
      leadsText += leadText;
      currentLength += leadText.length;
      displayedCount++;
    }
    
    // Якщо не всі ліди відображені, додаємо інформацію
    if (displayedCount < leads.length) {
      leadsText += `\n... та ще ${leads.length - displayedCount} лідов (повідомлення обрізано через обмеження Telegram)`;
    }

    const keyboard = await getKeyboardForUser(chat_id);
    // Якщо є кнопки для перегляду повної інформації, показуємо їх
    if (leadsKeyboard.inline_keyboard.length > 0) {
      await ctx.reply(leadsText, { reply_markup: leadsKeyboard });
    } else {
      await ctx.reply(leadsText, { reply_markup: keyboard });
    }
  } catch (error) {
    console.error('Error in worker_closed_leads callback:', error);
    await ctx.reply('❌ Помилка при отриманні закритих лідов.');
  }
});

// Закрити лід зі списку активних лідов
bot.callbackQuery(/^close_lead_(\d+)$/, async (ctx) => {
  try {
    await ctx.answerCallbackQuery();
    const chat_id = ctx.callbackQuery.message?.chat.id;
    const match = ctx.match;
    
    if (!chat_id || !match) {
      await ctx.reply('❌ Помилка отримання даних.');
      return;
    }

    const leadId = parseInt(match[1]);
    
    // Перевіряємо, чи це клоузер
    const { data: closer } = await supabase
      .from('analytics-users')
      .select('role')
      .eq('chat_id', chat_id)
      .single();

    if (!closer || closer.role !== 'closer') {
      const keyboard = await getKeyboardForUser(chat_id);
      await ctx.reply('❌ Ця функція доступна тільки для клоузерів.', { reply_markup: keyboard });
      return;
    }

    // Перевіряємо, чи лід належить цьому клоузеру
    const { data: lead, error: leadError } = await supabase
      .from('worker_leads')
      .select('*')
      .eq('id', leadId)
      .eq('closer_chat_id', chat_id)
      .single();

    if (leadError || !lead) {
      console.error('[CLOSE_LEAD] Error fetching lead:', leadError);
      const keyboard = await getKeyboardForUser(chat_id);
      await ctx.reply('❌ Лід не знайдено або не належить вам.', { reply_markup: keyboard });
      return;
    }

    // Перевіряємо, чи лід активний
    if (lead.lead_status !== 'new' && lead.lead_status !== 'contacted') {
      const keyboard = await getKeyboardForUser(chat_id);
      await ctx.reply('❌ Цей лід вже неактивний.', { reply_markup: keyboard });
      return;
    }

    // Оновлюємо статус ліда на "closed"
    const { error: updateError } = await supabase
      .from('worker_leads')
      .update({ lead_status: 'closed' })
      .eq('id', leadId);

    if (updateError) {
      console.error('[CLOSE_LEAD] Error updating lead status:', updateError);
      const keyboard = await getKeyboardForUser(chat_id);
      await ctx.reply('❌ Помилка при оновленні статусу ліда.', { reply_markup: keyboard });
      return;
    }

    // Отримуємо інформацію про воркера для повідомлення
    const { data: worker } = await supabase
      .from('analytics-users')
      .select('username, first_name')
      .eq('chat_id', lead.worker_chat_id)
      .single();

    const workerName = worker 
      ? `@${worker.username || worker.first_name || 'Unknown'}`
      : 'Невідомий воркер';

    let leadInfo = `🔒 Лід успішно закрито.\n\n`;
    leadInfo += `👤 Воркер: ${workerName}\n`;
    if (lead.lead_name) {
      leadInfo += `👤 Ім'я: ${lead.lead_name}\n`;
    }
    if (lead.lead_contact) {
      leadInfo += `📞 Контакт: ${lead.lead_contact}\n`;
    }

    const keyboard = await getKeyboardForUser(chat_id);
    await ctx.reply(leadInfo, { reply_markup: keyboard });
  } catch (error) {
    console.error('Error in close_lead callback:', error);
    await ctx.reply('❌ Помилка при закритті ліда.');
  }
});

// Відмовитися від ліда зі списку активних лідов
bot.callbackQuery(/^reject_lead_from_list_(\d+)$/, async (ctx) => {
  try {
    await ctx.answerCallbackQuery();
    const chat_id = ctx.callbackQuery.message?.chat.id;
    const match = ctx.match;
    
    if (!chat_id || !match) {
      await ctx.reply('❌ Помилка отримання даних.');
      return;
    }

    const leadId = parseInt(match[1]);
    
    // Перевіряємо, чи це клоузер
    const { data: closer } = await supabase
      .from('analytics-users')
      .select('role')
      .eq('chat_id', chat_id)
      .single();

    if (!closer || closer.role !== 'closer') {
      const keyboard = await getKeyboardForUser(chat_id);
      await ctx.reply('❌ Ця функція доступна тільки для клоузерів.', { reply_markup: keyboard });
      return;
    }

    // Перевіряємо, чи лід належить цьому клоузеру
    const { data: lead, error: leadError } = await supabase
      .from('worker_leads')
      .select('*')
      .eq('id', leadId)
      .eq('closer_chat_id', chat_id)
      .single();

    if (leadError || !lead) {
      console.error('[REJECT_LEAD_FROM_LIST] Error fetching lead:', leadError);
      const keyboard = await getKeyboardForUser(chat_id);
      await ctx.reply('❌ Лід не знайдено або не належить вам.', { reply_markup: keyboard });
      return;
    }

    // Перевіряємо, чи лід активний
    if (lead.lead_status !== 'new' && lead.lead_status !== 'contacted') {
      const keyboard = await getKeyboardForUser(chat_id);
      await ctx.reply('❌ Цей лід вже неактивний.', { reply_markup: keyboard });
      return;
    }

    // Оновлюємо статус ліда на "rejected"
    const { error: updateError } = await supabase
      .from('worker_leads')
      .update({ lead_status: 'rejected' })
      .eq('id', leadId);

    if (updateError) {
      console.error('[REJECT_LEAD_FROM_LIST] Error updating lead status:', updateError);
      const keyboard = await getKeyboardForUser(chat_id);
      await ctx.reply('❌ Помилка при оновленні статусу ліда.', { reply_markup: keyboard });
      return;
    }

    // Отримуємо інформацію про воркера для повідомлення
    const { data: worker } = await supabase
      .from('analytics-users')
      .select('username, first_name')
      .eq('chat_id', lead.worker_chat_id)
      .single();

    const workerName = worker 
      ? `@${worker.username || worker.first_name || 'Unknown'}`
      : 'Невідомий воркер';

    let leadInfo = `🚫 Відмова від ліда зареєстрована.\n\n`;
    leadInfo += `👤 Воркер: ${workerName}\n`;
    if (lead.lead_name) {
      leadInfo += `👤 Ім'я: ${lead.lead_name}\n`;
    }
    if (lead.lead_contact) {
      leadInfo += `📞 Контакт: ${lead.lead_contact}\n`;
    }

    const keyboard = await getKeyboardForUser(chat_id);
    await ctx.reply(leadInfo, { reply_markup: keyboard });
  } catch (error) {
    console.error('Error in reject_lead_from_list callback:', error);
    await ctx.reply('❌ Помилка при відмові від ліда.');
  }
});

// Перегляд повної інформації про лід
bot.callbackQuery(/^view_full_lead_(\d+)$/, async (ctx) => {
  try {
    await ctx.answerCallbackQuery();
    const chat_id = ctx.callbackQuery.message?.chat.id;
    const match = ctx.match;
    
    if (!chat_id || !match) {
      await ctx.reply('❌ Помилка отримання даних.');
      return;
    }

    const leadId = parseInt(match[1]);
    
    // Перевіряємо, чи це клоузер
    const { data: closer } = await supabase
      .from('analytics-users')
      .select('role')
      .eq('chat_id', chat_id)
      .single();

    if (!closer || closer.role !== 'closer') {
      const keyboard = await getKeyboardForUser(chat_id);
      await ctx.reply('❌ Ця функція доступна тільки для клоузерів.', { reply_markup: keyboard });
      return;
    }

    // Отримуємо повну інформацію про лід
    const { data: lead, error: leadError } = await supabase
      .from('worker_leads')
      .select('*')
      .eq('id', leadId)
      .eq('closer_chat_id', chat_id)
      .single();

    if (leadError || !lead) {
      console.error('[VIEW_FULL_LEAD] Error fetching lead:', leadError);
      const keyboard = await getKeyboardForUser(chat_id);
      await ctx.reply('❌ Лід не знайдено або не належить вам.', { reply_markup: keyboard });
      return;
    }

    // Отримуємо інформацію про воркера
    const { data: worker } = await supabase
      .from('analytics-users')
      .select('username, first_name')
      .eq('chat_id', lead.worker_chat_id)
      .single();

    const workerName = worker 
      ? `@${worker.username || worker.first_name || 'Unknown'}`
      : 'Невідомий воркер';

    // Форматуємо повну інформацію про лід
    const leadDate = new Date(lead.created_at).toLocaleString('uk-UA');
    const statusMap: { [key: string]: string } = {
      'new': '🆕 Новий',
      'contacted': '📞 В обробці',
      'converted': '✅ Конвертований',
      'lost': '❌ Втрачений',
      'rejected': '🚫 Відмовлений',
      'closed': '🔒 Закритий'
    };
    const status = statusMap[lead.lead_status] || lead.lead_status;

    let leadText = `📄 Повна інформація про лід #${lead.id}\n\n`;
    leadText += `👤 Воркер: ${workerName}\n`;
    leadText += `📅 Дата створення: ${leadDate}\n`;
    leadText += `📊 Статус: ${status}\n\n`;
    
    if (lead.lead_name) {
      leadText += `👤 Ім'я: ${lead.lead_name}\n`;
    }
    if (lead.lead_contact) {
      leadText += `📞 Контакт: ${lead.lead_contact}\n`;
    }
    if (lead.lead_info) {
      leadText += `\n📝 Повна інформація:\n${lead.lead_info}\n`;
    }
    if (lead.notes) {
      leadText += `\n📌 Нотатки: ${lead.notes}\n`;
    }

    const keyboard = await getKeyboardForUser(chat_id);
    await ctx.reply(leadText, { reply_markup: keyboard });
  } catch (error) {
    console.error('Error in view_full_lead callback:', error);
    await ctx.reply('❌ Помилка при отриманні інформації про лід.');
  }
});

// Перегляд повної інформації про звіт
bot.callbackQuery(/^view_full_report_(\d+)$/, async (ctx) => {
  try {
    await ctx.answerCallbackQuery();
    const chat_id = ctx.callbackQuery.message?.chat.id;
    const match = ctx.match;
    
    if (!chat_id || !match) {
      await ctx.reply('❌ Помилка отримання даних.');
      return;
    }

    const reportId = parseInt(match[1]);
    
    // Перевіряємо, чи це клоузер
    const { data: closer } = await supabase
      .from('analytics-users')
      .select('role')
      .eq('chat_id', chat_id)
      .single();

    if (!closer || closer.role !== 'closer') {
      const keyboard = await getKeyboardForUser(chat_id);
      await ctx.reply('❌ Ця функція доступна тільки для клоузерів.', { reply_markup: keyboard });
      return;
    }

    // Отримуємо повну інформацію про звіт
    const { data: report, error: reportError } = await supabase
      .from('worker_reports')
      .select('*')
      .eq('id', reportId)
      .eq('closer_chat_id', chat_id)
      .single();

    if (reportError || !report) {
      console.error('[VIEW_FULL_REPORT] Error fetching report:', reportError);
      const keyboard = await getKeyboardForUser(chat_id);
      await ctx.reply('❌ Звіт не знайдено або не належить вам.', { reply_markup: keyboard });
      return;
    }

    // Отримуємо інформацію про воркера
    const { data: worker } = await supabase
      .from('analytics-users')
      .select('username, first_name')
      .eq('chat_id', report.worker_chat_id)
      .single();

    const workerName = worker 
      ? `@${worker.username || worker.first_name || 'Unknown'}`
      : 'Невідомий воркер';

    // Форматуємо повну інформацію про звіт
    const reportDate = new Date(report.created_at).toLocaleString('uk-UA');
    const status = report.status === 'read' ? '✅ Прочитано' : '📬 Непрочитано';
    const typeMap: { [key: string]: string } = {
      'text': '💬 Текст',
      'photo': '📷 Фото',
      'document': '📄 Документ',
      'video': '🎥 Відео'
    };
    const type = typeMap[report.message_type] || report.message_type;

    let reportText = `📄 Повна інформація про звіт #${report.id}\n\n`;
    reportText += `👤 Воркер: ${workerName}\n`;
    reportText += `📅 Дата створення: ${reportDate}\n`;
    reportText += `📊 Статус: ${status}\n`;
    reportText += `📋 Тип: ${type}\n\n`;
    
    if (report.message_text) {
      reportText += `📝 Повний текст звіту:\n${report.message_text}\n`;
    }
    
    if (report.file_id) {
      reportText += `\n📎 ID файлу: ${report.file_id}`;
    }

    const keyboard = await getKeyboardForUser(chat_id);
    await ctx.reply(reportText, { reply_markup: keyboard });
  } catch (error) {
    console.error('Error in view_full_report callback:', error);
    await ctx.reply('❌ Помилка при отриманні інформації про звіт.');
  }
});

// Взяти лід в обробку
bot.callbackQuery(/^take_lead_(\d+)$/, async (ctx) => {
  try {
    await ctx.answerCallbackQuery();
    const chat_id = ctx.callbackQuery.message?.chat.id;
    const match = ctx.match;
    
    if (!chat_id || !match) {
      await ctx.reply('❌ Помилка отримання даних.');
      return;
    }

    const leadId = parseInt(match[1]);
    
    // Перевіряємо, чи це клоузер
    const { data: closer } = await supabase
      .from('analytics-users')
      .select('role')
      .eq('chat_id', chat_id)
      .single();

    if (!closer || closer.role !== 'closer') {
      const keyboard = await getKeyboardForUser(chat_id);
      await ctx.reply('❌ Ця функція доступна тільки для клоузерів.', { reply_markup: keyboard });
      return;
    }

    // Перевіряємо, чи лід належить цьому клоузеру
    const { data: lead, error: leadError } = await supabase
      .from('worker_leads')
      .select('*')
      .eq('id', leadId)
      .eq('closer_chat_id', chat_id)
      .single();

    if (leadError || !lead) {
      console.error('[TAKE_LEAD] Error fetching lead:', leadError);
      const keyboard = await getKeyboardForUser(chat_id);
      await ctx.reply('❌ Лід не знайдено або не належить вам.', { reply_markup: keyboard });
      return;
    }

    // Перевіряємо, чи лід ще новий
    if (lead.lead_status !== 'new') {
      const keyboard = await getKeyboardForUser(chat_id);
      await ctx.reply('❌ Цей лід вже в обробці або має інший статус.', { reply_markup: keyboard });
      return;
    }

    // Оновлюємо статус ліда на "contacted" (в обробці)
    const { error: updateError } = await supabase
      .from('worker_leads')
      .update({ lead_status: 'contacted' })
      .eq('id', leadId);

    if (updateError) {
      console.error('[TAKE_LEAD] Error updating lead status:', updateError);
      const keyboard = await getKeyboardForUser(chat_id);
      await ctx.reply('❌ Помилка при оновленні статусу ліда.', { reply_markup: keyboard });
      return;
    }

    // Отримуємо інформацію про воркера для повідомлення
    const { data: worker } = await supabase
      .from('analytics-users')
      .select('username, first_name')
      .eq('chat_id', lead.worker_chat_id)
      .single();

    const workerName = worker 
      ? `@${worker.username || worker.first_name || 'Unknown'}`
      : 'Невідомий воркер';

    let leadInfo = `✅ Лід успішно взято в обробку!\n\n`;
    leadInfo += `👤 Воркер: ${workerName}\n`;
    if (lead.lead_name) {
      leadInfo += `👤 Ім'я: ${lead.lead_name}\n`;
    }
    if (lead.lead_contact) {
      leadInfo += `📞 Контакт: ${lead.lead_contact}\n`;
    }
    if (lead.lead_info) {
      leadInfo += `📝 Інформація: ${lead.lead_info}\n`;
    }

    const keyboard = await getKeyboardForUser(chat_id);
    await ctx.reply(leadInfo, { reply_markup: keyboard });
  } catch (error) {
    console.error('Error in take_lead callback:', error);
    await ctx.reply('❌ Помилка при взятті ліда в обробку.');
  }
});

// Відмовитися від ліда
bot.callbackQuery(/^reject_lead_(\d+)$/, async (ctx) => {
  try {
    await ctx.answerCallbackQuery();
    const chat_id = ctx.callbackQuery.message?.chat.id;
    const match = ctx.match;
    
    if (!chat_id || !match) {
      await ctx.reply('❌ Помилка отримання даних.');
      return;
    }

    const leadId = parseInt(match[1]);
    
    // Перевіряємо, чи це клоузер
    const { data: closer } = await supabase
      .from('analytics-users')
      .select('role')
      .eq('chat_id', chat_id)
      .single();

    if (!closer || closer.role !== 'closer') {
      const keyboard = await getKeyboardForUser(chat_id);
      await ctx.reply('❌ Ця функція доступна тільки для клоузерів.', { reply_markup: keyboard });
      return;
    }

    // Перевіряємо, чи лід належить цьому клоузеру
    const { data: lead, error: leadError } = await supabase
      .from('worker_leads')
      .select('*')
      .eq('id', leadId)
      .eq('closer_chat_id', chat_id)
      .single();

    if (leadError || !lead) {
      console.error('[REJECT_LEAD] Error fetching lead:', leadError);
      const keyboard = await getKeyboardForUser(chat_id);
      await ctx.reply('❌ Лід не знайдено або не належить вам.', { reply_markup: keyboard });
      return;
    }

    // Перевіряємо, чи лід ще новий (не можна відмовитися від вже обробленого)
    if (lead.lead_status !== 'new') {
      const keyboard = await getKeyboardForUser(chat_id);
      await ctx.reply('❌ Цей лід вже має інший статус.', { reply_markup: keyboard });
      return;
    }

    // Оновлюємо статус ліда на "rejected" (відмова)
    const { error: updateError } = await supabase
      .from('worker_leads')
      .update({ lead_status: 'rejected' })
      .eq('id', leadId);

    if (updateError) {
      console.error('[REJECT_LEAD] Error updating lead status:', updateError);
      const keyboard = await getKeyboardForUser(chat_id);
      await ctx.reply('❌ Помилка при оновленні статусу ліда.', { reply_markup: keyboard });
      return;
    }

    // Отримуємо інформацію про воркера для повідомлення
    const { data: worker } = await supabase
      .from('analytics-users')
      .select('username, first_name')
      .eq('chat_id', lead.worker_chat_id)
      .single();

    const workerName = worker 
      ? `@${worker.username || worker.first_name || 'Unknown'}`
      : 'Невідомий воркер';

    let leadInfo = `❌ Відмова від ліда зареєстрована.\n\n`;
    leadInfo += `👤 Воркер: ${workerName}\n`;
    if (lead.lead_name) {
      leadInfo += `👤 Ім'я: ${lead.lead_name}\n`;
    }
    if (lead.lead_contact) {
      leadInfo += `📞 Контакт: ${lead.lead_contact}\n`;
    }
    if (lead.lead_info) {
      leadInfo += `📝 Інформація: ${lead.lead_info}\n`;
    }

    const keyboard = await getKeyboardForUser(chat_id);
    await ctx.reply(leadInfo, { reply_markup: keyboard });
  } catch (error) {
    console.error('Error in reject_lead callback:', error);
    await ctx.reply('❌ Помилка при відмові від ліда.');
  }
});

// Зробити активний лід неактивним
bot.callbackQuery(/^deactivate_lead_(\d+)$/, async (ctx) => {
  try {
    await ctx.answerCallbackQuery();
    const chat_id = ctx.callbackQuery.message?.chat.id;
    const match = ctx.match;
    
    if (!chat_id || !match) {
      await ctx.reply('❌ Помилка отримання даних.');
      return;
    }

    const leadId = parseInt(match[1]);
    
    // Перевіряємо, чи це клоузер
    const { data: closer } = await supabase
      .from('analytics-users')
      .select('role')
      .eq('chat_id', chat_id)
      .single();

    if (!closer || closer.role !== 'closer') {
      const keyboard = await getKeyboardForUser(chat_id);
      await ctx.reply('❌ Ця функція доступна тільки для клоузерів.', { reply_markup: keyboard });
      return;
    }

    // Перевіряємо, чи лід належить цьому клоузеру
    const { data: lead, error: leadError } = await supabase
      .from('worker_leads')
      .select('*')
      .eq('id', leadId)
      .eq('closer_chat_id', chat_id)
      .single();

    if (leadError || !lead) {
      console.error('[DEACTIVATE_LEAD] Error fetching lead:', leadError);
      const keyboard = await getKeyboardForUser(chat_id);
      await ctx.reply('❌ Лід не знайдено або не належить вам.', { reply_markup: keyboard });
      return;
    }

    // Перевіряємо, чи лід активний (new або contacted)
    if (lead.lead_status !== 'new' && lead.lead_status !== 'contacted') {
      const keyboard = await getKeyboardForUser(chat_id);
      await ctx.reply('❌ Цей лід вже неактивний.', { reply_markup: keyboard });
      return;
    }

    // Оновлюємо статус ліда на "rejected" (неактивний)
    // Можна також використовувати "closed" для закритих лідов
    const { error: updateError } = await supabase
      .from('worker_leads')
      .update({ lead_status: 'rejected' })
      .eq('id', leadId);

    if (updateError) {
      console.error('[DEACTIVATE_LEAD] Error updating lead status:', updateError);
      const keyboard = await getKeyboardForUser(chat_id);
      await ctx.reply('❌ Помилка при оновленні статусу ліда.', { reply_markup: keyboard });
      return;
    }

    // Отримуємо інформацію про воркера для повідомлення
    const { data: worker } = await supabase
      .from('analytics-users')
      .select('username, first_name')
      .eq('chat_id', lead.worker_chat_id)
      .single();

    const workerName = worker 
      ? `@${worker.username || worker.first_name || 'Unknown'}`
      : 'Невідомий воркер';

    let leadInfo = `❌ Лід зроблено неактивним.\n\n`;
    leadInfo += `👤 Воркер: ${workerName}\n`;
    if (lead.lead_name) {
      leadInfo += `👤 Ім'я: ${lead.lead_name}\n`;
    }
    if (lead.lead_contact) {
      leadInfo += `📞 Контакт: ${lead.lead_contact}\n`;
    }
    if (lead.lead_info) {
      leadInfo += `📝 Інформація: ${lead.lead_info}\n`;
    }

    const keyboard = await getKeyboardForUser(chat_id);
    await ctx.reply(leadInfo, { reply_markup: keyboard });
  } catch (error) {
    console.error('Error in deactivate_lead callback:', error);
    await ctx.reply('❌ Помилка при зміні статусу ліда.');
  }
});

// Зробити неактивний лід активним
bot.callbackQuery(/^activate_lead_(\d+)$/, async (ctx) => {
  try {
    await ctx.answerCallbackQuery();
    const chat_id = ctx.callbackQuery.message?.chat.id;
    const match = ctx.match;
    
    if (!chat_id || !match) {
      await ctx.reply('❌ Помилка отримання даних.');
      return;
    }

    const leadId = parseInt(match[1]);
    
    // Перевіряємо, чи це клоузер
    const { data: closer } = await supabase
      .from('analytics-users')
      .select('role')
      .eq('chat_id', chat_id)
      .single();

    if (!closer || closer.role !== 'closer') {
      const keyboard = await getKeyboardForUser(chat_id);
      await ctx.reply('❌ Ця функція доступна тільки для клоузерів.', { reply_markup: keyboard });
      return;
    }

    // Перевіряємо, чи лід належить цьому клоузеру
    const { data: lead, error: leadError } = await supabase
      .from('worker_leads')
      .select('*')
      .eq('id', leadId)
      .eq('closer_chat_id', chat_id)
      .single();

    if (leadError || !lead) {
      console.error('[ACTIVATE_LEAD] Error fetching lead:', leadError);
      const keyboard = await getKeyboardForUser(chat_id);
      await ctx.reply('❌ Лід не знайдено або не належить вам.', { reply_markup: keyboard });
      return;
    }

    // Перевіряємо, чи лід неактивний (converted, lost, rejected або closed)
    if (lead.lead_status !== 'converted' && lead.lead_status !== 'lost' && lead.lead_status !== 'rejected' && lead.lead_status !== 'closed') {
      const keyboard = await getKeyboardForUser(chat_id);
      await ctx.reply('❌ Цей лід вже активний.', { reply_markup: keyboard });
      return;
    }

    // Оновлюємо статус ліда на "new" (активний)
    const { error: updateError } = await supabase
      .from('worker_leads')
      .update({ lead_status: 'new' })
      .eq('id', leadId);

    if (updateError) {
      console.error('[ACTIVATE_LEAD] Error updating lead status:', updateError);
      const keyboard = await getKeyboardForUser(chat_id);
      await ctx.reply('❌ Помилка при оновленні статусу ліда.', { reply_markup: keyboard });
      return;
    }

    // Отримуємо інформацію про воркера для повідомлення
    const { data: worker } = await supabase
      .from('analytics-users')
      .select('username, first_name')
      .eq('chat_id', lead.worker_chat_id)
      .single();

    const workerName = worker 
      ? `@${worker.username || worker.first_name || 'Unknown'}`
      : 'Невідомий воркер';

    let leadInfo = `✅ Лід зроблено активним.\n\n`;
    leadInfo += `👤 Воркер: ${workerName}\n`;
    if (lead.lead_name) {
      leadInfo += `👤 Ім'я: ${lead.lead_name}\n`;
    }
    if (lead.lead_contact) {
      leadInfo += `📞 Контакт: ${lead.lead_contact}\n`;
    }
    if (lead.lead_info) {
      leadInfo += `📝 Інформація: ${lead.lead_info}\n`;
    }

    const keyboard = await getKeyboardForUser(chat_id);
    await ctx.reply(leadInfo, { reply_markup: keyboard });
  } catch (error) {
    console.error('Error in activate_lead callback:', error);
    await ctx.reply('❌ Помилка при зміні статусу ліда.');
  }
});

// Перегляд звітів воркерів (для клоузера)
bot.callbackQuery('view_reports', async (ctx) => {
  try {
    await ctx.answerCallbackQuery();
    const chat_id = ctx.callbackQuery.message?.chat.id;

    if (!chat_id) {
      await ctx.reply('❌ Помилка отримання chat_id.');
      return;
    }

    // Отримуємо всі непрочитані звіти
    const { data: unreadReports, error: unreadError } = await supabase
      .from('worker_reports')
      .select('*')
      .eq('closer_chat_id', chat_id)
      .eq('status', 'unread')
      .order('created_at', { ascending: false })
      .limit(10);

    if (unreadError) {
      console.error('Error fetching unread reports:', unreadError);
      await ctx.reply('❌ Помилка при отриманні звітів.');
      return;
    }

    // Отримуємо всі звіти (останні 20)
    const { data: allReports, error: allError } = await supabase
      .from('worker_reports')
      .select('*')
      .eq('closer_chat_id', chat_id)
      .order('created_at', { ascending: false })
      .limit(20);

    if (allError) {
      console.error('Error fetching all reports:', allError);
      await ctx.reply('❌ Помилка при отриманні звітів.');
      return;
    }

    if (!allReports || allReports.length === 0) {
      const keyboard = await getKeyboardForUser(chat_id);

      await ctx.reply('📋 У вас немає звітів від воркерів.', {
        reply_markup: keyboard
      });
      return;
    }

    // Формуємо список звітів
    const unreadCount = unreadReports?.length || 0;
    let reportsList = `📋 Звіти від воркерів\n\n`;
    
    if (unreadCount > 0) {
      reportsList += `🔴 Непрочитаних: ${unreadCount}\n\n`;
    }

    // Отримуємо інформацію про воркерів для кожного звіту
    const workerChatIds = [...new Set(allReports.map(r => r.worker_chat_id))];
    const { data: workers } = await supabase
      .from('analytics-users')
      .select('chat_id, username, first_name')
      .in('chat_id', workerChatIds);

    const workersMap = new Map();
    workers?.forEach(w => {
      workersMap.set(w.chat_id, w);
    });

    reportsList += allReports.map((report, idx) => {
      const worker = workersMap.get(report.worker_chat_id);
      const workerName = worker ? `@${worker.username || worker.first_name || 'Unknown'}` : 'Unknown';
      const date = new Date(report.created_at).toLocaleString('uk-UA');
      const status = report.status === 'unread' ? '🔴' : '✅';
      const typeEmoji = report.message_type === 'photo' ? '📷' : 
                       report.message_type === 'document' ? '📄' : 
                       report.message_type === 'video' ? '🎥' : '💬';
      
      const preview = report.message_text && report.message_text.length > 50 
        ? report.message_text.substring(0, 50) + '...' 
        : report.message_text || '(без тексту)';
      
      return `${idx + 1}. ${status} ${typeEmoji} ${workerName}\n   ${preview}\n   📅 ${date}`;
    }).join('\n\n');

    const keyboard = await getKeyboardForUser(chat_id);

    await ctx.reply(reportsList, {
      reply_markup: keyboard
    });
  } catch (error) {
    console.error('Error viewing reports:', error);
    await ctx.reply('❌ Помилка при перегляді звітів.');
  }
});

// Перегляд лідов від воркерів (для клоузера)
bot.callbackQuery('view_leads', async (ctx) => {
  try {
    await ctx.answerCallbackQuery();
    const chat_id = ctx.callbackQuery.message?.chat.id;

    if (!chat_id) {
      await ctx.reply('❌ Помилка отримання chat_id.');
      return;
    }

    // Отримуємо всі нові ліди
    const { data: newLeads, error: newError } = await supabase
      .from('worker_leads')
      .select('*')
      .eq('closer_chat_id', chat_id)
      .eq('lead_status', 'new')
      .order('created_at', { ascending: false })
      .limit(10);

    if (newError) {
      console.error('Error fetching new leads:', newError);
      await ctx.reply('❌ Помилка при отриманні лідов.');
      return;
    }

    // Отримуємо всі ліди (останні 20)
    const { data: allLeads, error: allError } = await supabase
      .from('worker_leads')
      .select('*')
      .eq('closer_chat_id', chat_id)
      .order('created_at', { ascending: false })
      .limit(20);

    if (allError) {
      console.error('Error fetching all leads:', allError);
      await ctx.reply('❌ Помилка при отриманні лідов.');
      return;
    }

    if (!allLeads || allLeads.length === 0) {
      const keyboard = await getKeyboardForUser(chat_id);

      await ctx.reply('👤 У вас немає лідов від воркерів.', {
        reply_markup: keyboard
      });
      return;
    }

    // Отримуємо інформацію про воркерів
    const workerChatIds = [...new Set(allLeads.map(l => l.worker_chat_id))];
    const { data: workers } = await supabase
      .from('analytics-users')
      .select('chat_id, username, first_name')
      .in('chat_id', workerChatIds);

    const workersMap = new Map();
    workers?.forEach(w => {
      workersMap.set(w.chat_id, w);
    });

    // Формуємо список лідов
    const newCount = newLeads?.length || 0;
    let leadsList = `👤 Ліди від воркерів\n\n`;
    
    if (newCount > 0) {
      leadsList += `🆕 Нових: ${newCount}\n\n`;
    }

    leadsList += allLeads.map((lead, idx) => {
      const worker = workersMap.get(lead.worker_chat_id);
      const workerName = worker ? `@${worker.username || worker.first_name || 'Unknown'}` : 'Unknown';
      const date = new Date(lead.created_at).toLocaleString('uk-UA');
      const statusEmoji = lead.lead_status === 'new' ? '🆕' : 
                         lead.lead_status === 'contacted' ? '📞' : 
                         lead.lead_status === 'converted' ? '✅' : '❌';
      
      let leadInfo = `${idx + 1}. ${statusEmoji} ${workerName}\n`;
      if (lead.lead_name) {
        leadInfo += `   👤 ${lead.lead_name}\n`;
      }
      if (lead.lead_contact) {
        leadInfo += `   📞 ${lead.lead_contact}\n`;
      }
      const infoPreview = lead.lead_info && lead.lead_info.length > 40 
        ? lead.lead_info.substring(0, 40) + '...' 
        : lead.lead_info || '(без інформації)';
      leadInfo += `   📝 ${infoPreview}\n`;
      leadInfo += `   📅 ${date}`;
      
      return leadInfo;
    }).join('\n\n');

    const keyboard = await getKeyboardForUser(chat_id);

    await ctx.reply(leadsList, {
      reply_markup: keyboard
    });
  } catch (error) {
    console.error('Error viewing leads:', error);
    await ctx.reply('❌ Помилка при перегляді лідов.');
  }
});

// Генерація посилання для клоузера
bot.callbackQuery('generate_link', async (ctx) => {
  try {
    await ctx.answerCallbackQuery();
    const chat_id = ctx.callbackQuery.message?.chat.id;

    if (!chat_id) {
      await ctx.reply('❌ Помилка отримання chat_id.');
      return;
    }

    // Генеруємо посилання
    const botUsername = (await bot.api.getMe()).username;
    const referralLink = `https://t.me/${botUsername}?start=closer_${chat_id}`;

    const keyboard = await getKeyboardForUser(chat_id);

    await ctx.reply(
      `🔗 Ваше реферальне посилання:\n\n${referralLink}\n\n📋 Скопіюйте це посилання та надішліть його воркерам. Коли вони перейдуть по ньому, вони автоматично прив'яжуться до вас.`,
      { reply_markup: keyboard }
    );
  } catch (error) {
    console.error('Error generating link:', error);
    await ctx.reply('❌ Помилка при генерації посилання.');
  }
});

// Список воркерів клоузера
bot.callbackQuery('my_workers', async (ctx) => {
  try {
    await ctx.answerCallbackQuery();
    const chat_id = ctx.callbackQuery.message?.chat.id;

    if (!chat_id) {
      await ctx.reply('❌ Помилка отримання chat_id.');
      return;
    }

    // Отримуємо всіх воркерів, прив'язаних до цього клоузера
    const { data: workers, error: workersError } = await supabase
      .from('analytics-users')
      .select('chat_id, username, first_name, created_at')
      .eq('ref_id', chat_id)
      .order('created_at', { ascending: false });

    if (workersError) {
      console.error('Error fetching workers:', workersError);
      await ctx.reply('❌ Помилка при отриманні списку воркерів.');
      return;
    }

    if (!workers || workers.length === 0) {
      const keyboard = await getKeyboardForUser(chat_id);

      await ctx.reply('👥 У вас поки немає прив\'язаних воркерів.\n\nСтворіть посилання та надішліть його воркерам.', {
        reply_markup: keyboard
      });
      return;
    }

    const workersList = workers.map((worker, idx) => {
      const date = new Date(worker.created_at).toLocaleDateString('uk-UA');
      return `${idx + 1}. @${worker.username || worker.first_name || 'Unknown'} (${worker.first_name || 'No name'})\n   📅 Приєднався: ${date}`;
    }).join('\n\n');

    const keyboard = await getKeyboardForUser(chat_id);

    await ctx.reply(
      `👥 Ваші воркери (${workers.length}):\n\n${workersList}`,
      { reply_markup: keyboard }
    );
  } catch (error) {
    console.error('Error getting workers list:', error);
    await ctx.reply('❌ Помилка при отриманні списку воркерів.');
  }
});

// Статистика по воркерам клоузера
bot.callbackQuery('workers_stats', async (ctx) => {
  try {
    await ctx.answerCallbackQuery();
    const chat_id = ctx.callbackQuery.message?.chat.id;

    if (!chat_id) {
      await ctx.reply('❌ Помилка отримання chat_id.');
      return;
    }

    // Отримуємо всіх воркерів
    const { data: workers } = await supabase
      .from('analytics-users')
      .select('chat_id')
      .eq('ref_id', chat_id);

    if (!workers || workers.length === 0) {
      await ctx.reply('👥 У вас немає прив\'язаних воркерів.');
      return;
    }

    const workerChatIds = workers.map(w => w.chat_id.toString());

    // Отримуємо статистику по платежах
    const { data: payments } = await supabase
      .from('payments')
      .select('amount, type, smm, created_at')
      .in('smm', workerChatIds);

    // Підрахунок статистики
    const totalAmount = payments?.reduce((sum, p) => {
      const amount = typeof p.amount === 'number' ? p.amount : parseFloat(p.amount || '0');
      return sum + (isNaN(amount) ? 0 : amount);
    }, 0) || 0;

    const tradingCount = payments?.filter(p => p.type === 'trading').length || 0;
    const icoCount = payments?.filter(p => p.type === 'ico').length || 0;

    // Статистика по кожному воркеру
    const workerStats: Record<string, { total: number; count: number }> = {};
    payments?.forEach(p => {
      if (p.smm && workerChatIds.includes(p.smm)) {
        if (!workerStats[p.smm]) {
          workerStats[p.smm] = { total: 0, count: 0 };
        }
        const amount = typeof p.amount === 'number' ? p.amount : parseFloat(p.amount || '0');
        workerStats[p.smm].total += isNaN(amount) ? 0 : amount;
        workerStats[p.smm].count += 1;
      }
    });

    const topWorkers = Object.entries(workerStats)
      .sort(([, a], [, b]) => b.total - a.total)
      .slice(0, 10)
      .map(([chatId, stats], idx) => {
        const worker = workers.find(w => w.chat_id.toString() === chatId);
        const workerName = worker ? `@${worker.username || 'Unknown'}` : chatId;
        return `${idx + 1}. ${workerName}: ${stats.total.toFixed(2)} USDT (${stats.count} платежів)`;
      })
      .join('\n');

    const keyboard = await getKeyboardForUser(chat_id);

    await ctx.reply(
      `📊 Статистика по вашим воркерам:\n\n` +
      `💰 Загальна сума: ${totalAmount.toFixed(2)} USDT\n` +
      `📊 Всього платежів: ${payments?.length || 0}\n` +
      `🔄 Trading: ${tradingCount}\n` +
      `🎯 ICO: ${icoCount}\n\n` +
      `🏆 Топ воркерів:\n${topWorkers || 'Немає даних'}`,
      { reply_markup: keyboard }
    );
  } catch (error) {
    console.error('Error getting workers stats:', error);
    await ctx.reply('❌ Помилка при отриманні статистики.');
  }
});

// Статистика клоузера
bot.callbackQuery('my_stats', async (ctx) => {
  try {
    await ctx.answerCallbackQuery();
    const chat_id = ctx.callbackQuery.message?.chat.id;

    if (!chat_id) {
      await ctx.reply('❌ Помилка отримання chat_id.');
      return;
    }

    // Отримуємо статистику по платежах, де closer = chat_id
    const { data: payments } = await supabase
      .from('payments')
      .select('amount, type, created_at')
      .eq('closer', chat_id.toString());

    const totalAmount = payments?.reduce((sum, p) => {
      const amount = typeof p.amount === 'number' ? p.amount : parseFloat(p.amount || '0');
      return sum + (isNaN(amount) ? 0 : amount);
    }, 0) || 0;

    const tradingAmount = payments?.filter(p => p.type === 'trading').reduce((sum, p) => {
      const amount = typeof p.amount === 'number' ? p.amount : parseFloat(p.amount || '0');
      return sum + (isNaN(amount) ? 0 : amount);
    }, 0) || 0;

    const icoAmount = payments?.filter(p => p.type === 'ico').reduce((sum, p) => {
      const amount = typeof p.amount === 'number' ? p.amount : parseFloat(p.amount || '0');
      return sum + (isNaN(amount) ? 0 : amount);
    }, 0) || 0;

    const keyboard = await getKeyboardForUser(chat_id);

    await ctx.reply(
      `📈 Ваша статистика:\n\n` +
      `💰 Загальна сума: ${totalAmount.toFixed(2)} USDT\n` +
      `📊 Всього платежів: ${payments?.length || 0}\n` +
      `🔄 Trading: ${tradingAmount.toFixed(2)} USDT\n` +
      `🎯 ICO: ${icoAmount.toFixed(2)} USDT`,
      { reply_markup: keyboard }
    );
  } catch (error) {
    console.error('Error getting stats:', error);
    await ctx.reply('❌ Помилка при отриманні статистики.');
  }
});

// Статистика за тиждень
bot.callbackQuery('stats_week', async (ctx) => {
  try {
    await ctx.answerCallbackQuery();
    const chat_id = ctx.callbackQuery.message?.chat.id;

    if (!chat_id) {
      await ctx.reply('❌ Помилка отримання chat_id.');
      return;
    }

    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    // Статистика клоузера
    const { data: closerPayments } = await supabase
      .from('payments')
      .select('amount, type')
      .eq('closer', chat_id.toString())
      .gte('created_at', weekAgo.toISOString());

    // Статистика воркерів
    const { data: workers } = await supabase
      .from('analytics-users')
      .select('chat_id')
      .eq('ref_id', chat_id);

    const workerChatIds = workers?.map(w => w.chat_id.toString()) || [];
    const { data: workerPayments } = await supabase
      .from('payments')
      .select('amount, type')
      .in('smm', workerChatIds)
      .gte('created_at', weekAgo.toISOString());

    const closerTotal = closerPayments?.reduce((sum, p) => {
      const amount = typeof p.amount === 'number' ? p.amount : parseFloat(p.amount || '0');
      return sum + (isNaN(amount) ? 0 : amount);
    }, 0) || 0;

    const workerTotal = workerPayments?.reduce((sum, p) => {
      const amount = typeof p.amount === 'number' ? p.amount : parseFloat(p.amount || '0');
      return sum + (isNaN(amount) ? 0 : amount);
    }, 0) || 0;

    const keyboard = await getKeyboardForUser(chat_id);

    await ctx.reply(
      `📅 Статистика за тиждень:\n\n` +
      `👤 Ваша статистика: ${closerTotal.toFixed(2)} USDT\n` +
      `👥 Статистика воркерів: ${workerTotal.toFixed(2)} USDT\n` +
      `💰 Загалом: ${(closerTotal + workerTotal).toFixed(2)} USDT`,
      { reply_markup: keyboard }
    );
  } catch (error) {
    console.error('Error getting week stats:', error);
    await ctx.reply('❌ Помилка при отриманні статистики.');
  }
});

// Статистика за місяць
bot.callbackQuery('stats_month', async (ctx) => {
  try {
    await ctx.answerCallbackQuery();
    const chat_id = ctx.callbackQuery.message?.chat.id;

    if (!chat_id) {
      await ctx.reply('❌ Помилка отримання chat_id.');
      return;
    }

    const monthAgo = new Date();
    monthAgo.setMonth(monthAgo.getMonth() - 1);

    // Статистика клоузера
    const { data: closerPayments } = await supabase
      .from('payments')
      .select('amount, type')
      .eq('closer', chat_id.toString())
      .gte('created_at', monthAgo.toISOString());

    // Статистика воркерів
    const { data: workers } = await supabase
      .from('analytics-users')
      .select('chat_id')
      .eq('ref_id', chat_id);

    const workerChatIds = workers?.map(w => w.chat_id.toString()) || [];
    const { data: workerPayments } = await supabase
      .from('payments')
      .select('amount, type')
      .in('smm', workerChatIds)
      .gte('created_at', monthAgo.toISOString());

    const closerTotal = closerPayments?.reduce((sum, p) => {
      const amount = typeof p.amount === 'number' ? p.amount : parseFloat(p.amount || '0');
      return sum + (isNaN(amount) ? 0 : amount);
    }, 0) || 0;

    const workerTotal = workerPayments?.reduce((sum, p) => {
      const amount = typeof p.amount === 'number' ? p.amount : parseFloat(p.amount || '0');
      return sum + (isNaN(amount) ? 0 : amount);
    }, 0) || 0;

    const keyboard = await getKeyboardForUser(chat_id);

    await ctx.reply(
      `📆 Статистика за місяць:\n\n` +
      `👤 Ваша статистика: ${closerTotal.toFixed(2)} USDT\n` +
      `👥 Статистика воркерів: ${workerTotal.toFixed(2)} USDT\n` +
      `💰 Загалом: ${(closerTotal + workerTotal).toFixed(2)} USDT`,
      { reply_markup: keyboard }
    );
  } catch (error) {
    console.error('Error getting month stats:', error);
    await ctx.reply('❌ Помилка при отриманні статистики.');
  }
});

// Статистика клоузера (для воркера)
bot.callbackQuery('closer_stats', async (ctx) => {
  try {
    await ctx.answerCallbackQuery();
    const chat_id = ctx.callbackQuery.message?.chat.id;

    if (!chat_id) {
      await ctx.reply('❌ Помилка отримання chat_id.');
      return;
    }

    // Отримуємо інформацію про воркера
    const { data: worker } = await supabase
      .from('analytics-users')
      .select('ref_id')
      .eq('chat_id', chat_id)
      .single();

    if (!worker || !worker.ref_id) {
      await ctx.reply('❌ Ви не прив\'язані до клоузера.');
      return;
    }

    // Отримуємо статистику клоузера
    const { data: closerPayments } = await supabase
      .from('payments')
      .select('amount, type')
      .eq('closer', worker.ref_id.toString());

    const totalAmount = closerPayments?.reduce((sum, p) => {
      const amount = typeof p.amount === 'number' ? p.amount : parseFloat(p.amount || '0');
      return sum + (isNaN(amount) ? 0 : amount);
    }, 0) || 0;

    const keyboard = await getKeyboardForUser(chat_id);

    await ctx.reply(
      `📈 Статистика вашого клоузера:\n\n` +
      `💰 Загальна сума: ${totalAmount.toFixed(2)} USDT\n` +
      `📊 Всього платежів: ${closerPayments?.length || 0}`,
      { reply_markup: keyboard }
    );
  } catch (error) {
    console.error('Error getting closer stats:', error);
    await ctx.reply('❌ Помилка при отриманні статистики.');
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
