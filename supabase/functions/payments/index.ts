import { serve } from "https://deno.land/std@0.131.0/http/server.ts";
import { Bot, webhookCallback, InlineKeyboard } from "https://deno.land/x/grammy@v1.8.3/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

console.log(`Function "payments" up and running!`);
const supabaseUrl = Deno.env.get("URL") || "";
const supabaseKey = Deno.env.get("KEY") || "";
const supabase = createClient(supabaseUrl, supabaseKey);
const bot = new Bot(Deno.env.get("payment-bot") || "");

// Команда /start
bot.command("start", async (ctx) => {
  const chat_id = ctx.message.chat.id;
  const username = ctx.message.chat.username || null;
  const first_name = ctx.message.chat.first_name || null;

  // Перевіряємо, чи користувач вже існує в таблиці users-payments
  const { data: existingUser, error: checkError } = await supabase
    .from('users-payments')
    .select('*')
    .eq('chat_id', chat_id)
    .single();

  // Якщо користувача немає, додаємо його
  if (!existingUser || checkError?.code === 'PGRST116') {
    try {
      const { error: insertError } = await supabase
        .from('users-payments')
        .insert({
          chat_id: chat_id,
          username: username,
          first_name: first_name
        });

      if (insertError) {
        console.error('Error adding user to users-payments:', insertError);
        await ctx.reply('Помилка при реєстрації. Спробуйте ще раз.');
        return;
      }

      const keyboard = new InlineKeyboard()
        .text('📊 Статистика по воркеру', 'stats_worker')
        .text('👤 Статистика по клоузеру', 'stats_closer').row()
        .text('📅 Статистика по тижню', 'stats_week')
        .text('📆 Статистика по місяцю', 'stats_month').row()
        .text('📈 Загальна статистика', 'stats_total');
      
      await ctx.reply('Вітаємо! Ви успішно зареєстровані.\n\nОберіть опцію статистики:', {
        reply_markup: keyboard
      });
    } catch (error) {
      console.error('Error processing registration:', error);
      await ctx.reply('Сталася помилка. Спробуйте ще раз.');
    }
  } else {
    // Якщо користувач вже існує, оновлюємо його дані
    try {
      const { error: updateError } = await supabase
        .from('users-payments')
        .update({
          username: username,
          first_name: first_name
        })
        .eq('chat_id', chat_id);

      if (updateError) {
        console.error('Error updating user in users-payments:', updateError);
      } else {
        const keyboard = new InlineKeyboard()
          .text('📊 Статистика по воркеру', 'stats_worker')
          .text('👤 Статистика по клоузеру', 'stats_closer').row()
          .text('📅 Статистика по тижню', 'stats_week')
          .text('📆 Статистика по місяцю', 'stats_month').row()
          .text('📈 Загальна статистика', 'stats_total');
        
        await ctx.reply('Вітаємо з поверненням!\n\nОберіть опцію статистики:', {
          reply_markup: keyboard
        });
      }
    } catch (error) {
      console.error('Error updating user:', error);
    }
  }
});

// Команда /stats
bot.command("stats", async (ctx) => {
  const keyboard = new InlineKeyboard()
    .text('📊 Статистика по воркеру', 'stats_worker')
    .text('👤 Статистика по клоузеру', 'stats_closer').row()
    .text('📅 Статистика по тижню', 'stats_week')
    .text('📆 Статистика по місяцю', 'stats_month').row()
    .text('📈 Загальна статистика', 'stats_total');
  
  await ctx.reply('Оберіть опцію статистики:', {
    reply_markup: keyboard
  });
});

// Функції для обчислення статистики
const getTotalStats = async () => {
  const { data, error } = await supabase
    .from('payments')
    .select('amount, type');
  
  if (error) throw error;
  
  const totalAmount = data?.reduce((sum, p) => {
    const amount = typeof p.amount === 'number' ? p.amount : parseFloat(p.amount || '0');
    return sum + (isNaN(amount) ? 0 : amount);
  }, 0) || 0;
  
  const tradingCount = data?.filter(p => p.type === 'trading').length || 0;
  const icoCount = data?.filter(p => p.type === 'ico').length || 0;
  const totalCount = data?.length || 0;
  
  return { totalAmount, tradingCount, icoCount, totalCount };
};

const getWeekStats = async () => {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  
  const { data, error } = await supabase
    .from('payments')
    .select('amount, type, closer, smm')
    .gte('created_at', weekAgo.toISOString());
  
  if (error) throw error;
  
  const totalAmount = data?.reduce((sum, p) => {
    const amount = typeof p.amount === 'number' ? p.amount : parseFloat(p.amount || '0');
    return sum + (isNaN(amount) ? 0 : amount);
  }, 0) || 0;
  
  const tradingCount = data?.filter(p => p.type === 'trading').length || 0;
  const icoCount = data?.filter(p => p.type === 'ico').length || 0;
  const totalCount = data?.length || 0;
  
  // Топ клоузерів за тиждень
  const closerStats: Record<string, number> = {};
  data?.forEach(p => {
    if (p.closer) {
      const amount = typeof p.amount === 'number' ? p.amount : parseFloat(p.amount || '0');
      closerStats[p.closer] = (closerStats[p.closer] || 0) + (isNaN(amount) ? 0 : amount);
    }
  });
  
  // Топ воркерів (smm) за тиждень
  const workerStats: Record<string, number> = {};
  data?.forEach(p => {
    if (p.smm) {
      const amount = typeof p.amount === 'number' ? p.amount : parseFloat(p.amount || '0');
      workerStats[p.smm] = (workerStats[p.smm] || 0) + (isNaN(amount) ? 0 : amount);
    }
  });
  
  return { totalAmount, tradingCount, icoCount, totalCount, closerStats, workerStats };
};

const getMonthStats = async () => {
  const now = new Date();
  const monthAgo = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
  
  const { data, error } = await supabase
    .from('payments')
    .select('amount, type, closer, smm')
    .gte('created_at', monthAgo.toISOString());
  
  if (error) throw error;
  
  const totalAmount = data?.reduce((sum, p) => {
    const amount = typeof p.amount === 'number' ? p.amount : parseFloat(p.amount || '0');
    return sum + (isNaN(amount) ? 0 : amount);
  }, 0) || 0;
  
  const tradingCount = data?.filter(p => p.type === 'trading').length || 0;
  const icoCount = data?.filter(p => p.type === 'ico').length || 0;
  const totalCount = data?.length || 0;
  
  // Топ клоузерів за місяць
  const closerStats: Record<string, number> = {};
  data?.forEach(p => {
    if (p.closer) {
      const amount = typeof p.amount === 'number' ? p.amount : parseFloat(p.amount || '0');
      closerStats[p.closer] = (closerStats[p.closer] || 0) + (isNaN(amount) ? 0 : amount);
    }
  });
  
  // Топ воркерів (smm) за місяць
  const workerStats: Record<string, number> = {};
  data?.forEach(p => {
    if (p.smm) {
      const amount = typeof p.amount === 'number' ? p.amount : parseFloat(p.amount || '0');
      workerStats[p.smm] = (workerStats[p.smm] || 0) + (isNaN(amount) ? 0 : amount);
    }
  });
  
  return { totalAmount, tradingCount, icoCount, totalCount, closerStats, workerStats };
};

const getWorkerStats = async () => {
  const { data, error } = await supabase
    .from('payments')
    .select('amount, type, smm');
  
  if (error) throw error;
  
  const workerStats: Record<string, { total: number; trading: number; ico: number; count: number }> = {};
  
  data?.forEach(p => {
    if (p.smm) {
      const amount = typeof p.amount === 'number' ? p.amount : parseFloat(p.amount || '0');
      const validAmount = isNaN(amount) ? 0 : amount;
      
      if (!workerStats[p.smm]) {
        workerStats[p.smm] = { total: 0, trading: 0, ico: 0, count: 0 };
      }
      
      workerStats[p.smm].total += validAmount;
      workerStats[p.smm].count += 1;
      
      if (p.type === 'trading') {
        workerStats[p.smm].trading += validAmount;
      } else if (p.type === 'ico') {
        workerStats[p.smm].ico += validAmount;
      }
    }
  });
  
  return workerStats;
};

const getCloserStats = async () => {
  const { data, error } = await supabase
    .from('payments')
    .select('amount, type, closer');
    
  
  if (error) throw error;
  
  const closerStats: Record<string, { total: number; trading: number; ico: number; count: number }> = {};
  
  data?.forEach(p => {
    if (p.closer) {
      const amount = typeof p.amount === 'number' ? p.amount : parseFloat(p.amount || '0');
      const validAmount = isNaN(amount) ? 0 : amount;
      
      if (!closerStats[p.closer]) {
        closerStats[p.closer] = { total: 0, trading: 0, ico: 0, count: 0 };
      }
      
      closerStats[p.closer].total += validAmount;
      closerStats[p.closer].count += 1;
      
      if (p.type === 'trading') {
        closerStats[p.closer].trading += validAmount;
      } else if (p.type === 'ico') {
        closerStats[p.closer].ico += validAmount;
      }
    }
  });
  
  return closerStats;
};

// Обробники callback-ів для кнопок статистики
bot.callbackQuery('stats_total', async (ctx) => {
  try {
    await ctx.answerCallbackQuery();
    const stats = await getTotalStats();
    
    const tradingPercent = stats.totalCount > 0 ? ((stats.tradingCount / stats.totalCount) * 100).toFixed(1) : '0';
    const icoPercent = stats.totalCount > 0 ? ((stats.icoCount / stats.totalCount) * 100).toFixed(1) : '0';
    
    const message = `📈 Загальна статистика\n\n` +
      `💰 Загальна сума: ${stats.totalAmount.toFixed(2)} USDT\n` +
      `📊 Всього платежів: ${stats.totalCount}\n` +
      `🔄 Trading: ${stats.tradingCount} (${tradingPercent}%)\n` +
      `🎯 ICO: ${stats.icoCount} (${icoPercent}%)`;
    
    const keyboard = new InlineKeyboard()
      .text('📊 Статистика по воркеру', 'stats_worker')
      .text('👤 Статистика по клоузеру', 'stats_closer').row()
      .text('📅 Статистика по тижню', 'stats_week')
      .text('📆 Статистика по місяцю', 'stats_month').row()
      .text('📈 Загальна статистика', 'stats_total');
    
    await ctx.reply(message, { reply_markup: keyboard });
  } catch (error) {
    console.error('Error getting total stats:', error);
    await ctx.reply('Помилка при отриманні статистики. Спробуйте ще раз.');
  }
});

bot.callbackQuery('stats_week', async (ctx) => {
  try {
    await ctx.answerCallbackQuery();
    const stats = await getWeekStats();
    
    const topClosers = Object.entries(stats.closerStats)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([name, amount], idx) => `${idx + 1}. ${name}: ${amount.toFixed(2)} USDT`)
      .join('\n');
    
    const topWorkers = Object.entries(stats.workerStats)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([name, amount], idx) => `${idx + 1}. ${name}: ${amount.toFixed(2)} USDT`)
      .join('\n');
    
    const message = `📅 Статистика за тиждень\n\n` +
      `💰 Загальна сума: ${stats.totalAmount.toFixed(2)} USDT\n` +
      `📊 Всього платежів: ${stats.totalCount}\n` +
      `🔄 Trading: ${stats.tradingCount}\n` +
      `🎯 ICO: ${stats.icoCount}\n\n` +
      `🏆 Топ 5 клоузерів:\n${topClosers || 'Немає даних'}\n\n` +
      `👥 Топ 5 воркерів:\n${topWorkers || 'Немає даних'}`;
    
    const keyboard = new InlineKeyboard()
      .text('📊 Статистика по воркеру', 'stats_worker')
      .text('👤 Статистика по клоузеру', 'stats_closer').row()
      .text('📅 Статистика по тижню', 'stats_week')
      .text('📆 Статистика по місяцю', 'stats_month').row()
      .text('📈 Загальна статистика', 'stats_total');
    
    await ctx.reply(message, { reply_markup: keyboard });
  } catch (error) {
    console.error('Error getting week stats:', error);
    await ctx.reply('Помилка при отриманні статистики. Спробуйте ще раз.');
  }
});

bot.callbackQuery('stats_month', async (ctx) => {
  try {
    await ctx.answerCallbackQuery();
    const stats = await getMonthStats();
    
    const topClosers = Object.entries(stats.closerStats)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([name, amount], idx) => `${idx + 1}. ${name}: ${amount.toFixed(2)} USDT`)
      .join('\n');
    
    const topWorkers = Object.entries(stats.workerStats)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([name, amount], idx) => `${idx + 1}. ${name}: ${amount.toFixed(2)} USDT`)
      .join('\n');
    
    const message = `📆 Статистика за місяць\n\n` +
      `💰 Загальна сума: ${stats.totalAmount.toFixed(2)} USDT\n` +
      `📊 Всього платежів: ${stats.totalCount}\n` +
      `🔄 Trading: ${stats.tradingCount}\n` +
      `🎯 ICO: ${stats.icoCount}\n\n` +
      `🏆 Топ 5 клоузерів:\n${topClosers || 'Немає даних'}\n\n` +
      `👥 Топ 5 воркерів:\n${topWorkers || 'Немає даних'}`;
    
    const keyboard = new InlineKeyboard()
      .text('📊 Статистика по воркеру', 'stats_worker')
      .text('👤 Статистика по клоузеру', 'stats_closer').row()
      .text('📅 Статистика по тижню', 'stats_week')
      .text('📆 Статистика по місяцю', 'stats_month').row()
      .text('📈 Загальна статистика', 'stats_total');
    
    await ctx.reply(message, { reply_markup: keyboard });
  } catch (error) {
    console.error('Error getting month stats:', error);
    await ctx.reply('Помилка при отриманні статистики. Спробуйте ще раз.');
  }
});

bot.callbackQuery('stats_worker', async (ctx) => {
  try {
    await ctx.answerCallbackQuery();
    const stats = await getWorkerStats();
    
    const workersList = Object.entries(stats)
      .sort(([, a], [, b]) => b.total - a.total)
      .slice(0, 10)
      .map(([name, data], idx) => 
        `${idx + 1}. ${name}:\n   💰 ${data.total.toFixed(2)} USDT (${data.count} платежів)\n   🔄 Trading: ${data.trading.toFixed(2)} USDT\n   🎯 ICO: ${data.ico.toFixed(2)} USDT`
      )
      .join('\n\n');
    
    const message = `📊 Статистика по воркерам\n\n${workersList || 'Немає даних'}`;
    
    const keyboard = new InlineKeyboard()
      .text('📊 Статистика по воркеру', 'stats_worker')
      .text('👤 Статистика по клоузеру', 'stats_closer').row()
      .text('📅 Статистика по тижню', 'stats_week')
      .text('📆 Статистика по місяцю', 'stats_month').row()
      .text('📈 Загальна статистика', 'stats_total');
    
    await ctx.reply(message, { reply_markup: keyboard });
  } catch (error) {
    console.error('Error getting worker stats:', error);
    await ctx.reply('Помилка при отриманні статистики. Спробуйте ще раз.');
  }
});

bot.callbackQuery('stats_closer', async (ctx) => {
  try {
    await ctx.answerCallbackQuery();
    const stats = await getCloserStats();
    
    const closersList = Object.entries(stats)
      .sort(([, a], [, b]) => b.total - a.total)
      .slice(0, 10)
      .map(([name, data], idx) => 
        `${idx + 1}. ${name}:\n   💰 ${data.total.toFixed(2)} USDT (${data.count} платежів)\n   🔄 Trading: ${data.trading.toFixed(2)} USDT\n   🎯 ICO: ${data.ico.toFixed(2)} USDT`
      )
      .join('\n\n');
    
    const message = `👤 Статистика по клоузерам\n\n${closersList || 'Немає даних'}`;
    
    const keyboard = new InlineKeyboard()
      .text('📊 Статистика по воркеру', 'stats_worker')
      .text('👤 Статистика по клоузеру', 'stats_closer').row()
      .text('📅 Статистика по тижню', 'stats_week')
      .text('📆 Статистика по місяцю', 'stats_month').row()
      .text('📈 Загальна статистика', 'stats_total');
    
    await ctx.reply(message, { reply_markup: keyboard });
  } catch (error) {
    console.error('Error getting closer stats:', error);
    await ctx.reply('Помилка при отриманні статистики. Спробуйте ще раз.');
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
