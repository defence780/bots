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

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const jsonResponse = (payload: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const keepLatestReportPerWorkerPerDay = (reports: any[]): any[] => {
  const seen = new Set<string>();
  const deduped: any[] = [];

  for (const report of reports) {
    const workerId =
      report.worker_chat_id === undefined || report.worker_chat_id === null
        ? ""
        : String(report.worker_chat_id);
    let dayKey = "";
    if (typeof report.created_at === "string" && report.created_at) {
      const date = new Date(report.created_at);
      if (!Number.isNaN(date.getTime())) {
        dayKey = date.toISOString().slice(0, 10);
      }
    }

    // If key fields are missing, keep the record untouched.
    if (!workerId || !dayKey) {
      deduped.push(report);
      continue;
    }

    // Queries are already ordered by created_at DESC, so first per worker/day is the latest.
    const dedupeKey = `${workerId}__${dayKey}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    deduped.push(report);
  }

  return deduped;
};

const handleNotifyMissingReport = async (body: Record<string, unknown>) => {
  const workerChatId = Number(body.worker_chat_id);
  const closerChatId = Number(body.closer_chat_id);
  const message =
    typeof body.message === "string" ? body.message.trim() : "";

  if (!workerChatId || Number.isNaN(workerChatId)) {
    return jsonResponse(
      { success: false, error: "worker_chat_id must be a valid number" },
      400,
    );
  }

  if (!closerChatId || Number.isNaN(closerChatId)) {
    return jsonResponse(
      { success: false, error: "closer_chat_id must be a valid number" },
      400,
    );
  }

  if (!message) {
    return jsonResponse(
      { success: false, error: "message is required" },
      400,
    );
  }

  const { data: worker, error: workerError } = await supabase
    .from("analytics-users")
    .select("chat_id, ref_id, role")
    .eq("chat_id", workerChatId)
    .single();

  if (workerError || !worker) {
    console.error("[NOTIFY_MISSING_REPORT] Worker not found:", workerError);
    return jsonResponse(
      { success: false, error: "worker not found" },
      404,
    );
  }

  if (worker.role !== "worker") {
    return jsonResponse(
      { success: false, error: "target user is not a worker" },
      400,
    );
  }

  if (!worker.ref_id || Number(worker.ref_id) !== closerChatId) {
    return jsonResponse(
      { success: false, error: "worker is not attached to this closer" },
      403,
    );
  }

  try {
    await bot.api.sendMessage(workerChatId, message);
    return jsonResponse({
      success: true,
      worker_chat_id: workerChatId,
      closer_chat_id: closerChatId,
    });
  } catch (sendError) {
    console.error("[NOTIFY_MISSING_REPORT] Error sending message:", sendError);
    return jsonResponse(
      { success: false, error: "failed to send message" },
      500,
    );
  }
};

// Функції для роботи зі станом очікування (зберігається в БД)
async function setAwaitingAction(chatId: number, action: 'report' | null, step?: string, formData?: any): Promise<void> {
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

async function getAwaitingAction(chatId: number): Promise<'report' | null> {
  const { data, error } = await supabase
    .from('analytics-users')
    .select('awaiting_action')
    .eq('chat_id', chatId)
    .single();
  
  if (error) {
    console.error('[STATE] Error getting awaiting_action:', error);
    return null;
  }
  
  return (data?.awaiting_action as 'report' | null) || null;
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
      .text('📋 Звіти за сьогодні').row()
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
      .text('📋 Звіти за сьогодні').row()
      .text('📅 Статистика за тиждень')
      .text('📆 Статистика за місяць');
  } else if (user?.role === 'worker') {
    // Клавіатура для воркера - тільки звіт
    return new Keyboard()
      .text('📝 Надіслати звіт');
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
    .text('📋 Звіти за сьогодні').row()
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

      await ctx.reply(`✅ Вітаємо! Ви успішно прив'язані до клоузера: @${closer.username || closer.first_name || 'Unknown'}\n\nТепер ви можете надсилати звіти.`);
      
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
          '📝 Крок 2/3: опиши, будь ласка, виконану за день роботу.\n\n' +
          'Можеш орієнтуватися на таку структуру:\n' +
          '1. Активні діалоги — (кількість)\n' +
          '2. Активні діалоги — (від 3-х днів спілкування)\n' +
          '3. Прогріви — (скільки було, на що)\n' +
          '4. Вброси — (скільки було)\n' +
          '5. Індикаторні вброси — (скільки було)\n' +
          '6. Нові контакти — (скільки, з якого джерела)\n' +
          '7. Пропозиції — (згода / відмова — чому)\n' +
          '8. Фільтрація — (кількість контактів в архіві)',
          { reply_markup: keyboard }
        );
        return;
      } else if (currentStep === 'report_description') {
        formData.description = text.trim();
        await setAwaitingAction(chat_id, 'report', 'report_results', formData);
        await ctx.reply(
          '✅ Опис збережено!\n\n' +
          '📊 Крок 3/3: надішли, будь ласка, скріншоти з результатами.\n\n' +
          'Можеш відправити кілька фото або документів підряд — кожен скрін буде автоматично збережено та надіслано клоузеру.',
          { reply_markup: keyboard }
        );
        return;
      } else if (currentStep === 'report_results') {
        // Третій (останній) крок: результати (та, за потреби, проблеми в тому ж полі)
        formData.results = text.trim();
        formData.problems = formData.problems || 'Немає';
        
        // Короткий текст для збереження в БД (тільки пункти 1 і 2)
        const dbReportText =
          `📅 Дата: ${formData.date}\n\n` +
          `📝 Виконана робота:\n${formData.description}`;

        // Повний текст (з результатами та проблемами) можна використати для відправки клоузеру
        const fullReportText =
          dbReportText +
          `\n\n📊 Результати:\n${formData.results}\n\n` +
          `⚠️ Проблеми та зауваження:\n${
            formData.problems === 'Немає' || formData.problems === '-' ? 'Відсутні' : formData.problems
          }`;

        const reportData: any = {
          worker_chat_id: chat_id,
          closer_chat_id: worker.ref_id,
          message_text: dbReportText,
          message_type: 'text',
          status: 'unread'
          // id не вказуємо - PostgreSQL автоматично згенерує його (BIGSERIAL)
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
        await ctx.reply(
          `❌ Помилка при збереженні звіту: ${insertError.message || insertError.code || 'Unknown error'}\n\nДеталі: ${JSON.stringify(
            insertError
          )}`
        );
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

        // Якщо в formData є медіа — створюємо окремі записи для кожного файлу
        const mediaItems = Array.isArray(formData?.media) ? formData.media : [];
        if (mediaItems.length > 0) {
          try {
            const mediaReports = mediaItems
              .filter((m: any) => m && m.file_id && m.type)
              .map((m: any) => ({
                worker_chat_id: chat_id,
                closer_chat_id: worker.ref_id,
                message_text: dbReportText,
                message_type: m.type,
                file_id: m.file_id,
                status: 'unread'
              }));

            if (mediaReports.length > 0) {
              console.log('[TEXT_HANDLER] Saving media reports for worker:', chat_id, 'count:', mediaReports.length);
              const { error: mediaError } = await supabase.from('worker_reports').insert(mediaReports);
              if (mediaError) {
                console.error('[TEXT_HANDLER] Error saving media reports:', mediaError);
              }
            }
          } catch (mediaErr) {
            console.error('[TEXT_HANDLER] Unexpected error while saving media reports:', mediaErr);
          }
        }

        await clearFormData(chat_id);

        // Відправляємо звіт клоузеру (повний текст, включно з результатами та проблемами)
        try {
          const workerName = `@${worker.username || worker.first_name || 'Unknown'}`;
          const reportDate = new Date(report.created_at).toLocaleString('uk-UA');
          const closerMessage = `📋 Новий звіт від воркера ${workerName}\n📅 ${reportDate}\n\n${fullReportText}`;
          
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
          '📅 Крок 1/3: Вкажіть дату та час роботи\n' +
          'Наприклад: 15.12.2024, 10:00-18:00\n' +
          'Або просто: Сьогодні',
          { reply_markup: keyboard }
        );
        return;
      }
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
            
            return {
              ...worker,
              reportsCount: reportsCount || 0
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
          workersList += `   📋 Звіти: ${worker.reportsCount}\n\n`;
          
          // Додаємо кнопки для кожного воркера
          workersKeyboard
            .text(`📋 Звіти`, `worker_reports_${worker.chat_id}`).row();
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

        const dedupedReports = keepLatestReportPerWorkerPerDay(reports || []);

        if (dedupedReports.length === 0) {
          const keyboard = await getKeyboardForUser(chat_id);
          await ctx.reply('📋 За сьогодні звітів немає.', { reply_markup: keyboard });
          return;
        }

        // Отримуємо інформацію про воркерів
        const workerChatIds = [...new Set(dedupedReports.map((r: any) => r.worker_chat_id))];
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
        let reportsText = `📋 Звіти за сьогодні (${dedupedReports.length}):\n\n`;
        const reportsKeyboard = new InlineKeyboard();
        let currentLength = reportsText.length;
        let displayedCount = 0;
        
        for (let idx = 0; idx < dedupedReports.length; idx++) {
          const report = dedupedReports[idx];
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
        if (displayedCount < dedupedReports.length) {
          reportsText += `\n... та ще ${dedupedReports.length - displayedCount} звітів (повідомлення обрізано через обмеження Telegram)`;
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

      // Всі команди для lead видалено - залишено лише функціонал report
      if (text === '📊 Статистика по воркерам' || text === '📈 Моя статистика' || 
          text === '📋 Звіти воркерів' ||
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
          '📅 Крок 1/3: Вкажіть дату та час роботи\n' +
          'Наприклад: 15.12.2024, 10:00-18:00\n' +
          'Або просто: Сьогодні',
          { reply_markup: keyboard }
        );
        return;
      }
      // Команда "Передати ліда" видалена - залишено лише функціонал report
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

      // Замість збереження в worker_reports одразу — акумулюємо медіа у form_data,
      // щоб пізніше створити записи з повним текстом (пункти 1–2).
      const safeCaption = messageText?.trim?.() || '';

      const mediaItem = {
        type: messageType,
        file_id: fileId,
        caption: safeCaption
      };

      const formData = await getFormData(chat_id);
      const existingMedia = Array.isArray(formData?.media) ? formData.media : [];
      const updatedFormData = {
        ...formData,
        media: [...existingMedia, mediaItem]
      };

      console.log('[MESSAGE] Added media item to form_data. Total media count:', updatedFormData.media.length);

      const currentStep = await getFormStep(chat_id);
      await setAwaitingAction(chat_id, 'report', currentStep || 'report_results', updatedFormData);

      await ctx.reply('✅ Скрін збережено до звіту. Можеш надіслати ще або написати наступний текстовий крок.');
      return;

      // Зберігаємо звіт в базу (СТАРА ЛОГІКА – тепер не використовується, залишено як fallback)
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
        // id не вказуємо - PostgreSQL автоматично згенерує його (BIGSERIAL)
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

    // Обробка lead та closer_report видалена - залишено лише функціонал report
    // Якщо не очікується звіт, не обробляємо повідомлення
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

    const dedupedReports = keepLatestReportPerWorkerPerDay(reports || []);

    if (dedupedReports.length === 0) {
      const keyboard = await getKeyboardForUser(chat_id);
      const workerName = `@${worker.username || worker.first_name || 'Unknown'}`;
      await ctx.reply(`📋 У воркера ${workerName} поки немає звітів.`, { reply_markup: keyboard });
      return;
    }

    // Форматуємо звіти
    const workerName = `@${worker.username || worker.first_name || 'Unknown'}`;
    let reportsText = `📋 Звіти воркера ${workerName} (${dedupedReports.length}):\n\n`;
    
    dedupedReports.forEach((report: any, idx: number) => {
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

// Всі callback handlers для lead видалені - залишено лише функціонал report

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

// Всі callback handlers для lead видалені - залишено лише функціонал report

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

    const dedupedUnreadReports = keepLatestReportPerWorkerPerDay(unreadReports || []);
    const dedupedAllReports = keepLatestReportPerWorkerPerDay(allReports || []);

    // Формуємо список звітів
    const unreadCount = dedupedUnreadReports.length || 0;
    let reportsList = `📋 Звіти від воркерів\n\n`;
    
    if (unreadCount > 0) {
      reportsList += `🔴 Непрочитаних: ${unreadCount}\n\n`;
    }

    // Отримуємо інформацію про воркерів для кожного звіту
    const workerChatIds = [...new Set(dedupedAllReports.map(r => r.worker_chat_id))];
    const { data: workers } = await supabase
      .from('analytics-users')
      .select('chat_id, username, first_name')
      .in('chat_id', workerChatIds);

    const workersMap = new Map();
    workers?.forEach(w => {
      workersMap.set(w.chat_id, w);
    });

    reportsList += dedupedAllReports.map((report, idx) => {
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

// view_leads callback handler видалено - залишено лише функціонал report

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
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    if (req.method === "POST") {
      const contentType = req.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        try {
          const body = await req.clone().json();
          if (body?.type === "notify_missing_report") {
            return await handleNotifyMissingReport(body as Record<string, unknown>);
          }
        } catch (parseError) {
          // Ignore JSON parsing errors for Telegram webhook requests.
          console.warn("[HTTP] Failed to parse JSON body for custom actions:", parseError);
        }
      }
    }

    return await handleUpdate(req);
  } catch (err) {
    console.error(err);
    return jsonResponse({ success: false, error: err.message }, 500);
  }
});
