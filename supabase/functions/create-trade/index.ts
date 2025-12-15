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

// Ініціалізуємо bot2 з BOT_TOKEN2
const botToken2 = Deno.env.get("BOT_TOKEN2");
if (!botToken2) {
  console.error('BOT_TOKEN2 is not set!');
}
const bot2 = new Bot(botToken2 || "");

// CORS headers
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  // Handle OPTIONS request
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const data = await req.formData();
    console.log("Received form data:", Object.fromEntries(data.entries()));

    const chat_id = data.get('chat_id');
    const ticker = data.get('ticker');
    const trade_type = data.get('trade_type');
    const price = data.get('price');
    const amount = data.get('amount') as string | null;
    const time_to_finish = data.get('time_to_finish');

    // Валідація вхідних даних
    if (!chat_id || !ticker || !trade_type || !amount || !time_to_finish) {
      return new Response(
        JSON.stringify({ 
          error: "Missing required fields", 
          required: ["chat_id", "ticker", "trade_type", "amount", "time_to_finish"] 
        }),
        { 
          headers: { ...corsHeaders, "Content-Type": "application/json" }, 
          status: 400 
        }
      );
    }

    // Валідація trade_type
    if (trade_type !== 'buy' && trade_type !== 'sell') {
      return new Response(
        JSON.stringify({ error: "Invalid trade_type. Must be 'buy' or 'sell'" }),
        { 
          headers: { ...corsHeaders, "Content-Type": "application/json" }, 
          status: 400 
        }
      );
    }

    // Валідація amount
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      return new Response(
        JSON.stringify({ error: "Invalid amount. Must be a positive number" }),
        { 
          headers: { ...corsHeaders, "Content-Type": "application/json" }, 
          status: 400 
        }
      );
    }

    console.log({ chat_id, ticker, trade_type, price, amount, time_to_finish });

    // Отримуємо користувача
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('chat_id', chat_id)
      .single();

    if (userError || !user) {
      console.error('Error fetching user:', userError);
      return new Response(
        JSON.stringify({ error: "User not found", details: userError?.message }),
        { 
          headers: { ...corsHeaders, "Content-Type": "application/json" }, 
          status: 404 
        }
      );
    }

    // Перевірка балансу
    const userBalance = parseFloat(user.usdt_amount || 0);
    if (userBalance < amountNum) {
      return new Response(
        JSON.stringify({ 
          error: "Insufficient balance", 
          balance: userBalance, 
          required: amountNum 
        }),
        { 
          headers: { ...corsHeaders, "Content-Type": "application/json" }, 
          status: 400 
        }
      );
    }

    // Перевірка наявності активного трейду
    const { data: activeTrades, error: activeTradesError } = await supabase
      .from('trades')
      .select('id')
      .eq('chat_id', chat_id)
      .eq('isActive', true);

    if (activeTradesError) {
      console.error('Error checking active trades:', activeTradesError);
      return new Response(
        JSON.stringify({ error: "Failed to check active trades", details: activeTradesError.message }),
        { 
          headers: { ...corsHeaders, "Content-Type": "application/json" }, 
          status: 500 
        }
      );
    }

    if (activeTrades && activeTrades.length > 0) {
      return new Response(
        JSON.stringify({ 
          error: "User already has an active trade", 
          activeTradesCount: activeTrades.length 
        }),
        { 
          headers: { ...corsHeaders, "Content-Type": "application/json" }, 
          status: 400 
        }
      );
    }

    const timeMap: { [key: string]: number } = {
      '20s': 20 * 1000,
      '30s': 30 * 1000,
      '1m': 60 * 1000,
      '5m': 5 * 60 * 1000,
      '15m': 15 * 60 * 1000,
      '30m': 30 * 60 * 1000,
      '1h': 60 * 60 * 1000,
    };

    const timeout = timeMap[time_to_finish as string];
    if (!timeout) {
      return new Response(
        JSON.stringify({ 
          error: "Invalid time_to_finish", 
          validValues: Object.keys(timeMap) 
        }),
        { 
          headers: { ...corsHeaders, "Content-Type": "application/json" }, 
          status: 400 
        }
      );
    }

    let isWin = user.auto_win;

    // Створюємо трейд
    const { data: tradeData, error: tradeError } = await supabase
      .from('trades')
      .insert({
        chat_id,
        token: ticker,
        trade_type,
        amount: amountNum,
        duration: timeout,
        isWin: null,
        isActive: true,
        ref_id: user?.ref_id || 0
      })
      .select()
      .single();

    if (tradeError || !tradeData) {
      console.error('Error creating trade:', tradeError);
      return new Response(
        JSON.stringify({ error: "Failed to create trade", details: tradeError?.message }),
        { 
          headers: { ...corsHeaders, "Content-Type": "application/json" }, 
          status: 500 
        }
      );
    }


    // Отримуємо оновлені дані користувача та воркера
    const { data: userTrade, error: userTradeError } = await supabase
      .from('users')
      .select('*')
      .eq('chat_id', chat_id)
      .single();

    if (userTradeError) {
      console.error('Error fetching user trade data:', userTradeError);
    }

    const { data: worker, error: workerError } = await supabase
      .from('users')
      .select('*')
      .eq('chat_id', user?.ref_id || 0)
      .single();

    const userKeyboard = new InlineKeyboard().text('Details', `details ${userTrade?.chat_id || chat_id}`);
    const winStatus = userTrade?.auto_win 
      ? 'Перемога' 
      : userTrade?.auto_win === null 
        ? 'Казино' 
        : 'Програш';
    const workerComment = worker?.comment || '';

    // Відправляємо повідомлення про створення трейду через BOT_TOKEN2
    console.log('[CREATE-TRADE] Sending notification about new trade...');
    console.log('[CREATE-TRADE] BOT_TOKEN2 available:', !!botToken2);
    console.log('[CREATE-TRADE] User ref_id:', user.ref_id);
    
    if (!botToken2) {
      console.error('[CREATE-TRADE] BOT_TOKEN2 is not set, cannot send messages');
    } else {
      // Виправлена логіка: перевірка чи ref_id НЕ є одним з цих значень (використовуємо && замість ||)
      const isSpecialRef = user.ref_id === 7561947088 || user.ref_id === 7184660397 || user.ref_id === 6993432791;

      if (!isSpecialRef && user.ref_id) {
        // Відправляємо повідомлення worker
        try {
          console.log('[CREATE-TRADE] Sending message to worker:', user.ref_id);
          await bot2.api.sendMessage(
            user.ref_id,
            `Користувач @${userTrade?.username || 'Unknown'} Відкрив трейд Токен: ${ticker} \n ${trade_type === 'buy' ? 'Купив' : 'Продав'} ${amount} \n Закриття на ${winStatus}`,
            { reply_markup: userKeyboard }
          );
          console.log('[CREATE-TRADE] Message sent to worker successfully');
        } catch (botError: any) {
          if (botError?.error_code === 403 && botError?.description?.includes('blocked')) {
            console.warn(`[CREATE-TRADE] Bot is blocked by worker ${user.ref_id} - skipping`);
          } else {
            console.error('[CREATE-TRADE] Error sending message to worker:', {
              error: botError,
              error_code: botError?.error_code,
              description: botError?.description
            });
          }
        }
        
        // Відправляємо повідомлення адміну окремо
        try {
          console.log('[CREATE-TRADE] Sending message to admin:', 6993432791);
          await bot2.api.sendMessage(
            6993432791,
            `Користувач @${userTrade?.username || 'Unknown'} Відкрив трейд Токен: ${ticker} \n ${trade_type === 'buy' ? 'Купив' : 'Продав'} ${amount} \n Закриття на ${winStatus} \n worker ${workerComment}`,
            { reply_markup: userKeyboard }
          );
          console.log('[CREATE-TRADE] Message sent to admin successfully');
        } catch (botError: any) {
          if (botError?.error_code === 403 && botError?.description?.includes('blocked')) {
            console.warn(`[CREATE-TRADE] Bot is blocked by admin 6993432791 - skipping`);
          } else {
            console.error('[CREATE-TRADE] Error sending message to admin:', {
              error: botError,
              error_code: botError?.error_code,
              description: botError?.description
            });
          }
        }
      } else {
        console.log('[CREATE-TRADE] Sending messages to all admins (special ref)');
        const adminIds = [7561947088, 7184660397, 6993432791];
        const messageText = `Користувач @${userTrade?.username || 'Unknown'} Відкрив трейд Токен: ${ticker} \n ${trade_type === 'buy' ? 'Купив' : 'Продав'} ${amount} \n Закриття на ${winStatus} \n worker ${workerComment}`;
        
        // Відправляємо повідомлення кожному адміну окремо, щоб помилка одного не блокувала інші
        for (const adminId of adminIds) {
          try {
            console.log(`[CREATE-TRADE] Sending message to admin ${adminId}...`);
            await bot2.api.sendMessage(adminId, messageText, { reply_markup: userKeyboard });
            console.log(`[CREATE-TRADE] Message sent to admin ${adminId} successfully`);
          } catch (botError: any) {
            // Обробляємо різні типи помилок
            if (botError?.error_code === 403 && botError?.description?.includes('blocked')) {
              console.warn(`[CREATE-TRADE] Bot is blocked by admin ${adminId} - skipping`);
            } else {
              console.error(`[CREATE-TRADE] Error sending message to admin ${adminId}:`, {
                error: botError,
                error_code: botError?.error_code,
                description: botError?.description
              });
            }
          }
        }
      }
    }
    // Встановлюємо таймер для закриття трейду
    setTimeout(async () => {
      try {
        // Визначаємо результат (якщо не встановлено, випадковий)
        let finalIsWin = isWin;
        if (finalIsWin === null) {
          finalIsWin = Math.random() >= 0.5;
        }

        // Перевіряємо, чи трейд ще активний
        const { data: activeTrade, error: activeTradeError } = await supabase
          .from('trades')
          .select('isActive, amount')
          .eq('id', tradeData.id)
          .single();

        if (activeTradeError) {
          console.error('Error checking trade status:', activeTradeError);
          return;
        }

        if (!activeTrade?.isActive) {
          console.log(`Trade ${tradeData.id} is no longer active, skipping closure.`);
          return;
        }

        const tradeAmount = parseFloat(activeTrade.amount || amountNum);

        // Перевіряємо та підготовлюємо параметри
        if (isNaN(tradeAmount) || tradeAmount <= 0) {
          console.error(`Invalid trade amount: ${tradeAmount} for trade ${tradeData.id}`);
          return;
        }

        if (finalIsWin === null || finalIsWin === undefined) {
          console.error(`Invalid is_win value: ${finalIsWin} for trade ${tradeData.id}`);
          return;
        }

        // Конвертуємо chat_id до числа, якщо потрібно
        const chatIdNum = typeof chat_id === 'string' ? parseInt(chat_id, 10) : Number(chat_id);
        if (isNaN(chatIdNum)) {
          console.error(`Invalid chat_id: ${chat_id} for trade ${tradeData.id}`);
          return;
        }

        const requestBody = {
          operation: 'update_trade_balance',
          chat_id: chatIdNum,
          trade_id: Number(tradeData.id),
          is_win: Boolean(finalIsWin),
          amount: Number(tradeAmount)
        };

        console.log(`[CREATE-TRADE] Attempting to update trade balance:`, {
          tradeId: tradeData.id,
          chatId: chatIdNum,
          isWin: finalIsWin,
          amount: tradeAmount,
          requestBody
        });

        // Використовуємо атомарну транзакцію для оновлення балансу та статусу трейду
        // Додаємо retry логіку для помилок конфлікту балансу (409)
        let atomicResult: any = null;
        let atomicError: any = null;
        const maxRetries = 3;
        let retryCount = 0;

        while (retryCount < maxRetries) {
          console.log(`[CREATE-TRADE] Attempt ${retryCount + 1}/${maxRetries} - Invoking atomic-transactions with:`, JSON.stringify(requestBody));
          
          const result = await supabase.functions.invoke('atomic-transactions', {
            body: requestBody
          });

          console.log(`[CREATE-TRADE] Response from atomic-transactions (attempt ${retryCount + 1}):`, {
            hasData: !!result.data,
            hasError: !!result.error,
            data: result.data,
            error: result.error,
            errorStatus: result.error?.context?.status
          });

          atomicResult = result.data;
          atomicError = result.error;

          // Якщо успішно або помилка не 409 (Conflict), виходимо з циклу
          if (!atomicError && atomicResult?.success) {
            console.log(`Trade ${tradeData.id} balance updated successfully on attempt ${retryCount + 1}`);
            break;
          }

          // Якщо помилка 409 (Conflict) - спробуємо ще раз
          if (atomicError?.context?.status === 409 || atomicResult?.error?.includes('conflict')) {
            retryCount++;
            if (retryCount < maxRetries) {
              const delay = Math.min(1000 * retryCount, 3000); // Експоненційна затримка: 1s, 2s, 3s
              console.log(`Balance conflict detected for trade ${tradeData.id}, retrying in ${delay}ms (attempt ${retryCount + 1}/${maxRetries})...`);
              
              // Спробуємо отримати деталі помилки
              let errorDetails: any = null;
              try {
                if (atomicError?.context && !atomicError.context.bodyUsed) {
                  const response = atomicError.context as Response;
                  const text = await response.clone().text();
                  errorDetails = JSON.parse(text);
                  console.log(`[CREATE-TRADE] Conflict error details:`, errorDetails);
                }
              } catch (e) {
                console.warn(`[CREATE-TRADE] Failed to parse conflict error details:`, e);
              }
              
              // Отримуємо актуальний баланс перед повторною спробою
              const { data: currentUser } = await supabase
                .from('users')
                .select('usdt_amount')
                .eq('chat_id', chatIdNum)
                .single();
              
              if (currentUser) {
                const actualBalance = parseFloat(currentUser.usdt_amount || 0);
                console.log(`[CREATE-TRADE] Current balance before retry:`, {
                  actualBalance,
                  tradeAmount: tradeAmount,
                  isWin: finalIsWin
                });
              }
              
              await new Promise(resolve => setTimeout(resolve, delay));
              continue;
            } else {
              console.error(`[CREATE-TRADE] Max retries reached for trade ${tradeData.id} due to balance conflict`);
            }
          }

          // Якщо помилка 400 (Bad Request) - перевіряємо деталі
          if (atomicError?.context?.status === 400) {
            // Спробуємо отримати деталі помилки з response
            let errorDetails: any = null;
            let errorText: string | null = null;
            
            try {
              // Спробуємо клонувати body перед читанням
              if (atomicError?.context?.body) {
                const response = atomicError.context as Response;
                if (response.body && !response.bodyUsed) {
                  errorText = await response.clone().text();
                  if (errorText) {
                    errorDetails = JSON.parse(errorText);
                  }
                }
              }
            } catch (e) {
              console.warn(`Failed to parse error details:`, e);
            }

            console.log(`[CREATE-TRADE] Error 400 details for trade ${tradeData.id}:`, {
              errorText,
              errorDetails,
              atomicResult,
              requestBody
            });

            // Якщо трейд вже закритий - це не помилка, просто ігноруємо
            const isAlreadyClosed = errorDetails?.error === 'Trade is already closed' || 
                                   errorText?.includes('Trade is already closed') ||
                                   atomicResult?.error === 'Trade is already closed';
            
            if (isAlreadyClosed) {
              console.log(`Trade ${tradeData.id} is already closed, skipping balance update`);
              // Перевіряємо статус трейду для підтвердження
              const { data: tradeCheck } = await supabase
                .from('trades')
                .select('isActive, isWin')
                .eq('id', tradeData.id)
                .single();
              
              if (tradeCheck && !tradeCheck.isActive) {
                console.log(`Trade ${tradeData.id} confirmed as closed. Result: ${tradeCheck.isWin ? 'WIN' : 'LOSE'}`);
                // Вважаємо операцію успішною, бо трейд вже закритий
                atomicResult = { success: true, alreadyClosed: true };
                atomicError = null;
                break;
              }
            }

            // Для інших помилок 400 - логуємо та виходимо
            console.error(`Bad request error for trade ${tradeData.id} (not retrying):`, {
              error: atomicError,
              errorText,
              errorDetails,
              result: atomicResult,
              requestBody
            });
            break;
          }

          // Якщо інша помилка або досягнуто максимум спроб - виходимо
          break;
        }

        // Перевіряємо, чи операція успішна (включаючи випадок, коли трейд вже закритий)
        if (atomicError || (!atomicResult?.success && !atomicResult?.alreadyClosed)) {
          // Отримуємо деталі помилки з response body, якщо можливо
          let errorDetails: any = null;
          let errorText: string | null = null;
          
          if (atomicError?.context) {
            try {
              const response = atomicError.context as Response;
              if (response.body && !response.bodyUsed) {
                errorText = await response.clone().text();
                if (errorText) {
                  errorDetails = JSON.parse(errorText);
                }
              }
            } catch (e) {
              console.warn(`Failed to parse error details in final error handler:`, e);
            }
          }

          console.error('Error in atomic trade update after retries:', {
            error: atomicError,
            errorStatus: atomicError?.context?.status,
            errorText,
            errorDetails,
            result: atomicResult,
            retryCount,
            tradeId: tradeData.id,
            chatId: chatIdNum,
            requestBody
          });
          // Не повертаємося відразу - спробуємо оновити статус трейду вручну
          // щоб він не залишився активним назавжди
          try {
            await supabase
              .from('trades')
              .update({ isActive: false, isWin: finalIsWin })
              .eq('id', tradeData.id);
            console.log(`Trade ${tradeData.id} status updated manually after balance update failure`);
          } catch (statusError) {
            console.error(`Failed to update trade ${tradeData.id} status manually:`, statusError);
          }
          return;
        }

        // Якщо трейд вже був закритий, просто логуємо
        if (atomicResult?.alreadyClosed) {
          console.log(`Trade ${tradeData.id} was already closed, no balance update needed`);
        } else {
          console.log(`Trade ${tradeData.id} finished. Result: ${finalIsWin ? 'WIN' : 'LOSE'}. New balance: ${atomicResult.newBalance}`);
        }
      } catch (error) {
        console.error('Error in trade closure timeout:', error);
      }
    }, timeout);

    console.log(`Trade created successfully. ID: ${tradeData.id}, will close in ${timeout}ms`);

    return new Response(
      JSON.stringify({
        success: true,
        trade: {
          id: tradeData.id,
          chat_id,
          token: ticker,
          trade_type,
          amount: amountNum,
          duration: timeout,
          isActive: true,
        },
      }),
      { 
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200
      }
    );
  } catch (error) {
    console.error('Unexpected error:', error);
    return new Response(
      JSON.stringify({ 
        error: "Internal server error", 
        details: error instanceof Error ? error.message : String(error) 
      }),
      { 
        headers: { ...corsHeaders, "Content-Type": "application/json" }, 
        status: 500 
      }
    );
  }
})

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/create-invoice' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
    --header 'Content-Type: application/json' \
    --data '{"name":"Functions"}'

*/
