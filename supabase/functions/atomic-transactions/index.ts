// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2";
import { Bot, InlineKeyboard } from "https://deno.land/x/grammy@v1.8.3/mod.ts";

console.log("Hello from atomic-transactions Functions!")

const supabaseUrl = Deno.env.get("URL") || "";
const supabaseKey = Deno.env.get("KEY") || "";
const supabase = createClient(supabaseUrl, supabaseKey);

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

  try {
    console.log('[ATOMIC-TRANSACTIONS] Received request:', {
      method: req.method,
      url: req.url,
      headers: Object.fromEntries(req.headers.entries())
    });

    let body: any;
    try {
      body = await req.json();
      console.log('[ATOMIC-TRANSACTIONS] Request body:', JSON.stringify(body, null, 2));
    } catch (parseError) {
      console.error('[ATOMIC-TRANSACTIONS] Failed to parse request body:', parseError);
      return new Response(
        JSON.stringify({ error: "Invalid JSON in request body", details: parseError instanceof Error ? parseError.message : String(parseError) }),
        { 
          headers: { ...corsHeaders, "Content-Type": "application/json" }, 
          status: 400 
        }
      );
    }
    
    const { operation, ...params } = body;
    
    console.log('[ATOMIC-TRANSACTIONS] Parsed operation:', operation);
    console.log('[ATOMIC-TRANSACTIONS] Parsed params:', JSON.stringify(params, null, 2));
    console.log('[ATOMIC-TRANSACTIONS] Params type check:', {
      operation_type: typeof operation,
      params_type: typeof params,
      params_is_object: typeof params === 'object' && params !== null,
      params_keys: params ? Object.keys(params) : 'null'
    });

    if (!operation) {
      return new Response(
        JSON.stringify({ error: "Missing required field: operation" }),
        { 
          headers: { ...corsHeaders, "Content-Type": "application/json" }, 
          status: 400 
        }
      );
    }

    switch (operation) {
      case 'deposit':
        return await handleDeposit(params);
      case 'withdraw':
        return await handleWithdraw(params);
      case 'exchange':
        return await handleExchange(params);
      case 'update_invoice_balance':
        return await handleUpdateInvoiceBalance(params);
      case 'update_trade_balance':
        return await handleUpdateTradeBalance(params);
      case 'process_deposit':
        return await handleProcessDeposit(params);
      case 'create_binary_option':
        return await handleCreateBinaryOption(params);
      default:
        return new Response(
          JSON.stringify({ error: `Unknown operation: ${operation}` }),
          { 
            headers: { ...corsHeaders, "Content-Type": "application/json" }, 
            status: 400 
          }
        );
    }
  } catch (error) {
    console.error('[ATOMIC-TRANSACTIONS] Unexpected error:', {
      error,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      name: error instanceof Error ? error.name : undefined,
      cause: error instanceof Error ? error.cause : undefined
    });
    return new Response(
      JSON.stringify({ 
        error: "Internal server error", 
        details: error instanceof Error ? error.message : String(error),
        type: error instanceof Error ? error.name : typeof error
      }),
      { 
        headers: { ...corsHeaders, "Content-Type": "application/json" }, 
        status: 500 
      }
    );
  }
});

// Атомарна операція депозиту
async function handleDeposit(params: any) {
  const { chat_id, amount, currency, invoice_id } = params;

  if (!chat_id || !amount || !currency) {
    return new Response(
      JSON.stringify({ error: "Missing required fields: chat_id, amount, currency" }),
      { 
        headers: { ...corsHeaders, "Content-Type": "application/json" }, 
        status: 400 
      }
    );
  }

  const column = currency.toLowerCase() === 'rub' ? 'rub_amount' : 'usdt_amount';
  const amountNum = parseFloat(amount);

  if (isNaN(amountNum) || amountNum <= 0) {
    return new Response(
      JSON.stringify({ error: "Invalid amount" }),
      { 
        headers: { ...corsHeaders, "Content-Type": "application/json" }, 
        status: 400 
      }
    );
  }

  try {
    // Отримуємо поточний баланс з блокуванням рядка (SELECT FOR UPDATE)
    const { data: user, error: userError } = await supabase
      .from('users')
      .select(`${column}, id`)
      .eq('chat_id', chat_id)
      .single();

    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "User not found" }),
        { 
          headers: { ...corsHeaders, "Content-Type": "application/json" }, 
          status: 404 
        }
      );
    }

    const currentBalance = parseFloat(user[column] || 0);
    const newBalance = currentBalance + amountNum;

    // Використовуємо PostgreSQL RPC функцію для атомарної операції
    // Якщо RPC функція не існує, використовуємо fallback з перевіркою
    try {
      const { data: rpcResult, error: rpcError } = await supabase.rpc('atomic_deposit', {
        p_chat_id: chat_id,
        p_column: column,
        p_amount: amountNum,
        p_new_balance: newBalance,
        p_invoice_id: invoice_id || null
      });

      if (!rpcError && rpcResult) {
        // RPC функція успішно виконана
        // Перевіряємо результат
        if (rpcResult.success === false) {
          return new Response(
            JSON.stringify({ error: rpcResult.error || "Failed to process deposit" }),
            { 
              headers: { ...corsHeaders, "Content-Type": "application/json" }, 
              status: 500 
            }
          );
        }
      } else {
        // Fallback до оптимістичного блокування, якщо RPC не існує
        console.log('RPC function not available, using optimistic locking fallback');
        
        // Атомарно оновлюємо баланс та інвойс (якщо вказано)
        const updates: Promise<any>[] = [
          supabase
            .from('users')
            .update({ [column]: newBalance })
            .eq('chat_id', chat_id)
            .eq(column, currentBalance) // Оптимістичне блокування
        ];

        if (invoice_id) {
          updates.push(
            supabase
              .from('invoices')
              .update({ isPayed: true })
              .eq('invoice_id', invoice_id)
              .eq('isPayed', false) // Оновлюємо тільки якщо ще не оплачений
          );
        }

        const results = await Promise.all(updates);

        // Перевіряємо, чи всі операції успішні
        const hasError = results.some(r => r.error);
        if (hasError) {
          const errors = results.filter(r => r.error).map(r => r.error);
          console.error('Error in atomic deposit:', errors);
          return new Response(
            JSON.stringify({ error: "Failed to process deposit", details: errors }),
            { 
              headers: { ...corsHeaders, "Content-Type": "application/json" }, 
              status: 500 
            }
          );
        }

        // Перевіряємо, чи було оновлено хоча б один рядок
        // Якщо баланс змінився між читанням і оновленням, жоден рядок не буде оновлено
        if (results[0].data === null || (Array.isArray(results[0].data) && results[0].data.length === 0)) {
          // Баланс змінився під час операції - конфлікт
          return new Response(
            JSON.stringify({ error: "Balance conflict, please retry" }),
            { 
              headers: { ...corsHeaders, "Content-Type": "application/json" }, 
              status: 409 
            }
          );
        }

        // Перевіряємо, чи баланс дійсно оновився
        const { data: updatedUser } = await supabase
          .from('users')
          .select(column)
          .eq('chat_id', chat_id)
          .single();

        if (updatedUser && parseFloat(updatedUser[column] || 0) !== newBalance) {
          // Конфлікт - баланс змінився під час операції
          return new Response(
            JSON.stringify({ error: "Balance conflict, please retry" }),
            { 
              headers: { ...corsHeaders, "Content-Type": "application/json" }, 
              status: 409 
            }
          );
        }
      }
    } catch (fallbackError) {
      console.error('Error in deposit operation:', fallbackError);
      return new Response(
        JSON.stringify({ error: "Internal server error", details: fallbackError instanceof Error ? fallbackError.message : String(fallbackError) }),
        { 
          headers: { ...corsHeaders, "Content-Type": "application/json" }, 
          status: 500 
        }
      );
    }

    // Логуємо транзакцію
    try {
      await supabase
        .from('atomic_transactions')
        .insert({
          operation: 'deposit',
          chat_id: chat_id,
          amount: amountNum,
          currency: currency,
          old_balance: currentBalance,
          new_balance: newBalance,
          invoice_id: invoice_id || null,
          status: 'success',
          created_at: new Date().toISOString()
        });
    } catch (logError) {
      console.error('Error logging transaction:', logError);
      // Не повертаємо помилку, бо основна операція вже виконана
    }

    return new Response(
      JSON.stringify({ 
        success: true,
        operation: 'deposit',
        chat_id,
        amount: amountNum,
        currency,
        newBalance,
        invoice_id: invoice_id || null
      }),
      { 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );
  } catch (error) {
    console.error('Error in handleDeposit:', error);
    return new Response(
      JSON.stringify({ error: "Internal server error", details: error instanceof Error ? error.message : String(error) }),
      { 
        headers: { ...corsHeaders, "Content-Type": "application/json" }, 
        status: 500 
      }
    );
  }
}

// Атомарна операція виведення
async function handleWithdraw(params: any) {
  const { chat_id, amount, currency, withdraw_id } = params;

  if (!chat_id || !amount || !currency) {
    return new Response(
      JSON.stringify({ error: "Missing required fields: chat_id, amount, currency" }),
      { 
        headers: { ...corsHeaders, "Content-Type": "application/json" }, 
        status: 400 
      }
    );
  }

  const column = currency.toLowerCase() === 'rub' ? 'rub_amount' : 'usdt_amount';
  const amountNum = parseFloat(amount);

  if (isNaN(amountNum) || amountNum <= 0) {
    return new Response(
      JSON.stringify({ error: "Invalid amount" }),
      { 
        headers: { ...corsHeaders, "Content-Type": "application/json" }, 
        status: 400 
      }
    );
  }

  try {
    // Отримуємо поточний баланс
    const { data: user, error: userError } = await supabase
      .from('users')
      .select(`${column}, id`)
      .eq('chat_id', chat_id)
      .single();

    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "User not found" }),
        { 
          headers: { ...corsHeaders, "Content-Type": "application/json" }, 
          status: 404 
        }
      );
    }

    const currentBalance = parseFloat(user[column] || 0);

    if (currentBalance < amountNum) {
      return new Response(
        JSON.stringify({ error: "Insufficient balance", balance: currentBalance, required: amountNum }),
        { 
          headers: { ...corsHeaders, "Content-Type": "application/json" }, 
          status: 400 
        }
      );
    }

    const newBalance = currentBalance - amountNum;

    console.log('[WITHDRAW] Starting withdraw operation:', {
      chat_id,
      amount: amountNum,
      currency,
      currentBalance,
      newBalance,
      withdraw_id
    });

    // Спробуємо використати RPC функцію для атомарного виведення
    try {
      console.log('[WITHDRAW] Attempting to use RPC function atomic_withdraw...');
      const { data: rpcResult, error: rpcError } = await supabase.rpc('atomic_withdraw', {
        p_chat_id: typeof chat_id === 'string' ? parseInt(chat_id) : chat_id,
        p_column: column,
        p_amount: amountNum,
        p_new_balance: newBalance,
        p_withdraw_id: withdraw_id || null
      });

      console.log('[WITHDRAW] RPC function response:', {
        rpcError,
        rpcResult,
        hasError: !!rpcError,
        hasResult: !!rpcResult
      });

      if (rpcError) {
        console.error('[WITHDRAW] RPC function error:', {
          error: rpcError,
          message: rpcError.message,
          details: rpcError.details,
          hint: rpcError.hint,
          code: rpcError.code
        });
        // Продовжуємо до fallback
        throw new Error(`RPC_ERROR: ${rpcError.message || 'Unknown RPC error'}`);
      }

      if (rpcResult) {
        console.log('[WITHDRAW] RPC function result:', JSON.stringify(rpcResult));
        
        if (typeof rpcResult === 'object' && rpcResult !== null) {
          if ('success' in rpcResult && rpcResult.success === false) {
            console.error('[WITHDRAW] RPC function returned error:', rpcResult.error);
            return new Response(
              JSON.stringify({ 
                error: rpcResult.error || "Failed to process withdraw",
                reason: "RPC function error",
                details: rpcResult.details || rpcResult
              }),
              { 
                headers: { ...corsHeaders, "Content-Type": "application/json" }, 
                status: 500 
              }
            );
          }

          if ('success' in rpcResult && rpcResult.success === true) {
            // RPC функція успішно виконана
            console.log('[WITHDRAW] RPC function completed successfully:', {
              newBalance: rpcResult.new_balance
            });
            
            const finalBalance = rpcResult.new_balance || newBalance;
            
            // Логуємо транзакцію
            try {
              console.log('[WITHDRAW] Logging transaction to atomic_transactions table...');
              const { error: logError } = await supabase
                .from('atomic_transactions')
                .insert({
                  operation: 'withdraw',
                  chat_id: chat_id,
                  amount: amountNum,
                  currency: currency,
                  old_balance: currentBalance,
                  new_balance: finalBalance,
                  withdraw_id: withdraw_id || null,
                  status: 'success',
                  created_at: new Date().toISOString()
                });
              
              if (logError) {
                console.error('[WITHDRAW] Error logging transaction (non-critical):', logError);
              } else {
                console.log('[WITHDRAW] Transaction logged successfully');
              }
            } catch (logError) {
              console.error('[WITHDRAW] Exception while logging transaction (non-critical):', logError);
            }

            console.log('[WITHDRAW] Withdraw completed successfully via RPC');

            // Відправляємо повідомлення про створення заявки на вивід
            if (withdraw_id) {
              try {
                console.log('[WITHDRAW] Sending notification about withdraw request...');
                await sendWithdrawNotification(chat_id, withdraw_id, amountNum, currency);
              } catch (notifError) {
                console.error('[WITHDRAW] Error sending withdraw notification (non-critical):', notifError);
              }
            }

            return new Response(
              JSON.stringify({ 
                success: true,
                operation: 'withdraw',
                chat_id,
                amount: amountNum,
                currency,
                newBalance: finalBalance,
                withdraw_id: withdraw_id || null
              }),
              { 
                headers: { ...corsHeaders, "Content-Type": "application/json" } 
              }
            );
          } else {
            console.warn('[WITHDRAW] RPC result does not have success=true, using fallback');
            throw new Error('RPC_INVALID_RESULT');
          }
        } else {
          console.warn('[WITHDRAW] RPC result is not an object, using fallback');
          throw new Error('RPC_INVALID_RESULT');
        }
      } else {
        console.warn('[WITHDRAW] RPC function returned no result, using fallback');
        throw new Error('RPC_NO_RESULT');
      }
    } catch (rpcFallbackError: any) {
      console.log('[WITHDRAW] RPC function failed, using fallback:', rpcFallbackError.message);
      
      // Fallback до оптимістичного блокування
      // Перевіряємо фактичні баланси перед оновленням (для діагностики)
      const { data: currentUserCheck } = await supabase
        .from('users')
        .select(column)
        .eq('chat_id', chat_id)
        .single();

      if (currentUserCheck) {
        const actualBalance = parseFloat(currentUserCheck[column] || 0);
        
        console.log('[WITHDRAW] Current balance in DB before update:', {
          expected: currentBalance,
          actual: actualBalance,
          match: actualBalance === currentBalance
        });

        if (actualBalance !== currentBalance) {
          console.error('[WITHDRAW] Balance changed between read and update:', {
            expected: currentBalance,
            actual: actualBalance,
            difference: actualBalance - currentBalance
          });
          return new Response(
            JSON.stringify({ 
              error: "Balance conflict, please retry",
              reason: "Balance changed during operation",
              expected: currentBalance,
              actual: actualBalance
            }),
            { 
              headers: { ...corsHeaders, "Content-Type": "application/json" }, 
              status: 409 
            }
          );
        }
      }

      // Атомарно оновлюємо баланс та створюємо/оновлюємо withdraw
      console.log('[WITHDRAW] Attempting fallback update with conditions:', {
        chat_id,
        [column]: currentBalance,
        newBalance
      });

      const updates: Promise<any>[] = [
        supabase
          .from('users')
          .update({ [column]: newBalance })
          .eq('chat_id', chat_id)
          .eq(column, currentBalance) // Оптимістичне блокування
          .select()
      ];

      if (withdraw_id) {
        // Оновлюємо існуючий withdraw
        updates.push(
          supabase
            .from('withdraws')
            .update({ isDone: false })
            .eq('id', withdraw_id)
        );
      }

      const results = await Promise.all(updates);

      console.log('[WITHDRAW] Fallback update result:', {
        results: results.map((r, idx) => ({ 
          index: idx,
          error: r.error, 
          data: r.data,
          count: Array.isArray(r.data) ? r.data.length : (r.data ? 1 : 0)
        })),
        hasError: results.some(r => r.error),
        firstResultHasData: results[0]?.data !== null && results[0]?.data !== undefined
      });

      // Перевіряємо, чи всі операції успішні
      const hasError = results.some(r => r.error);
      if (hasError) {
        const errors = results.filter(r => r.error).map(r => r.error);
        console.error('[WITHDRAW] Error in fallback withdraw:', errors);
        return new Response(
          JSON.stringify({ error: "Failed to process withdraw", details: errors }),
          { 
            headers: { ...corsHeaders, "Content-Type": "application/json" }, 
            status: 500 
          }
        );
      }

      // Перевіряємо, чи було оновлено хоча б один рядок
      const firstResult = results[0];
      const rowsUpdated = Array.isArray(firstResult.data) ? firstResult.data.length : (firstResult.data ? 1 : 0);
      
      console.log('[WITHDRAW] Rows updated check:', {
        rowsUpdated,
        hasData: firstResult.data !== null && firstResult.data !== undefined,
        dataType: Array.isArray(firstResult.data) ? 'array' : typeof firstResult.data
      });

      if (rowsUpdated === 0) {
        // Отримуємо актуальний баланс для діагностики
        const { data: diagnosticUser } = await supabase
          .from('users')
          .select(column)
          .eq('chat_id', chat_id)
          .single();

        console.error('[WITHDRAW] No rows updated - balance conflict detected:', {
          expectedBalance: currentBalance,
          chat_id,
          actualBalance: diagnosticUser ? diagnosticUser[column] : 'User not found',
          column
        });
        
        return new Response(
          JSON.stringify({ 
            error: "Balance conflict, please retry",
            reason: "Balance changed during operation - no rows were updated",
            expected: currentBalance,
            actual: diagnosticUser ? diagnosticUser[column] : null,
            column
          }),
          { 
            headers: { ...corsHeaders, "Content-Type": "application/json" }, 
            status: 409 
          }
        );
      }

      // Перевіряємо, чи баланс дійсно оновився
      const updatedUserData = Array.isArray(firstResult.data) ? firstResult.data[0] : firstResult.data;
      if (updatedUserData) {
        const updatedBalance = parseFloat(updatedUserData[column] || 0);
        const balanceDiff = Math.abs(updatedBalance - newBalance);
        
        console.log('[WITHDRAW] Verification result:', {
          expected: newBalance,
          actual: updatedBalance,
          diff: balanceDiff,
          match: balanceDiff < 0.01
        });

        // Допускаємо невелику різницю через округлення (до 0.01)
        if (balanceDiff > 0.01) {
          console.error('[WITHDRAW] Balance mismatch after update:', {
            expected: newBalance,
            actual: updatedBalance,
            difference: updatedBalance - newBalance
          });
          return new Response(
            JSON.stringify({ 
              error: "Balance conflict, please retry",
              reason: "Balance did not match expected value after update",
              expected: newBalance,
              actual: updatedBalance
            }),
            { 
              headers: { ...corsHeaders, "Content-Type": "application/json" }, 
              status: 409 
            }
          );
        }
      } else {
        // Якщо немає даних в результаті, перевіряємо окремим запитом
        const { data: updatedUser } = await supabase
          .from('users')
          .select(column)
          .eq('chat_id', chat_id)
          .single();

        if (updatedUser) {
          const updatedBalance = parseFloat(updatedUser[column] || 0);
          const balanceDiff = Math.abs(updatedBalance - newBalance);
          
          console.log('[WITHDRAW] Verification result (separate query):', {
            expected: newBalance,
            actual: updatedBalance,
            diff: balanceDiff,
            match: balanceDiff < 0.01
          });

          if (balanceDiff > 0.01) {
            console.error('[WITHDRAW] Balance mismatch after update (separate query):', {
              expected: newBalance,
              actual: updatedBalance,
              difference: updatedBalance - newBalance
            });
            return new Response(
              JSON.stringify({ 
                error: "Balance conflict, please retry",
                reason: "Balance did not match expected value after update",
                expected: newBalance,
                actual: updatedBalance
              }),
              { 
                headers: { ...corsHeaders, "Content-Type": "application/json" }, 
                status: 409 
              }
            );
          }
        }
      }
    }

    // Логуємо транзакцію
    try {
      await supabase
        .from('atomic_transactions')
        .insert({
          operation: 'withdraw',
          chat_id: chat_id,
          amount: amountNum,
          currency: currency,
          old_balance: currentBalance,
          new_balance: newBalance,
          withdraw_id: withdraw_id || null,
          status: 'success',
          created_at: new Date().toISOString()
        });
    } catch (logError) {
      console.error('Error logging transaction:', logError);
    }

    // Відправляємо повідомлення про створення заявки на вивід
    if (withdraw_id) {
      try {
        console.log('[WITHDRAW] Sending notification about withdraw request (fallback)...');
        await sendWithdrawNotification(chat_id, withdraw_id, amountNum, currency);
      } catch (notifError) {
        console.error('[WITHDRAW] Error sending withdraw notification (non-critical):', notifError);
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true,
        operation: 'withdraw',
        chat_id,
        amount: amountNum,
        currency,
        newBalance,
        withdraw_id: withdraw_id || null
      }),
      { 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );
  } catch (error) {
    console.error('Error in handleWithdraw:', error);
    return new Response(
      JSON.stringify({ error: "Internal server error", details: error instanceof Error ? error.message : String(error) }),
      { 
        headers: { ...corsHeaders, "Content-Type": "application/json" }, 
        status: 500 
      }
    );
  }
}

// Атомарна операція обміну
async function handleExchange(params: any) {
    console.log('[EXCHANGE] Starting exchange operation with params:', JSON.stringify(params));
  
  const { chat_id, from_currency, to_currency, amount, exchange_rate } = params as {
    chat_id: number | string;
    from_currency: string;
    to_currency: string;
    amount: number | string;
    exchange_rate: number | string;
  };

  // Валідація вхідних параметрів
  if (!chat_id || !from_currency || !to_currency || !amount || !exchange_rate) {
    const missingFields = [];
    if (!chat_id) missingFields.push('chat_id');
    if (!from_currency) missingFields.push('from_currency');
    if (!to_currency) missingFields.push('to_currency');
    if (!amount) missingFields.push('amount');
    if (!exchange_rate) missingFields.push('exchange_rate');
    
    console.error('[EXCHANGE] Missing required fields:', missingFields);
    return new Response(
      JSON.stringify({ 
        error: "Missing required fields", 
        missing: missingFields,
        received: { chat_id, from_currency, to_currency, amount, exchange_rate }
      }),
      { 
        headers: { ...corsHeaders, "Content-Type": "application/json" }, 
        status: 400 
      }
    );
  }

  const fromColumn = from_currency.toLowerCase() === 'rub' ? 'rub_amount' : 'usdt_amount';
  const toColumn = to_currency.toLowerCase() === 'rub' ? 'rub_amount' : 'usdt_amount';
  const amountNum = parseFloat(amount);
  const rateNum = parseFloat(exchange_rate);

  console.log('[EXCHANGE] Parsed values:', {
    fromColumn,
    toColumn,
    amountNum,
    rateNum,
    from_currency: from_currency.toLowerCase(),
    to_currency: to_currency.toLowerCase()
  });

  if (isNaN(amountNum) || amountNum <= 0 || isNaN(rateNum) || rateNum <= 0) {
    console.error('[EXCHANGE] Invalid amount or exchange_rate:', {
      amountNum,
      rateNum,
      amount,
      exchange_rate,
      isAmountNaN: isNaN(amountNum),
      isRateNaN: isNaN(rateNum)
    });
    return new Response(
      JSON.stringify({ 
        error: "Invalid amount or exchange_rate",
        details: {
          amount: { raw: amount, parsed: amountNum, isValid: !isNaN(amountNum) && amountNum > 0 },
          exchange_rate: { raw: exchange_rate, parsed: rateNum, isValid: !isNaN(rateNum) && rateNum > 0 }
        }
      }),
      { 
        headers: { ...corsHeaders, "Content-Type": "application/json" }, 
        status: 400 
      }
    );
  }

  try {
    console.log('[EXCHANGE] Fetching user data for chat_id:', chat_id);
    // Отримуємо поточні баланси
    const { data: user, error: userError } = await supabase
      .from('users')
      .select(`${fromColumn}, ${toColumn}, id`)
      .eq('chat_id', chat_id)
      .single();

    if (userError) {
      console.error('[EXCHANGE] Error fetching user:', {
        error: userError,
        message: userError.message,
        code: userError.code,
        details: userError.details,
        hint: userError.hint
      });
      return new Response(
        JSON.stringify({ 
          error: "User not found or database error",
          details: userError.message,
          code: userError.code
        }),
        { 
          headers: { ...corsHeaders, "Content-Type": "application/json" }, 
          status: 404 
        }
      );
    }

    if (!user) {
      console.error('[EXCHANGE] User not found for chat_id:', chat_id);
      return new Response(
        JSON.stringify({ error: "User not found", chat_id }),
        { 
          headers: { ...corsHeaders, "Content-Type": "application/json" }, 
          status: 404 
        }
      );
    }

    console.log('[EXCHANGE] User data retrieved:', {
      userId: user.id,
      [fromColumn]: user[fromColumn],
      [toColumn]: user[toColumn]
    });

    const fromBalance = parseFloat(user[fromColumn] || 0);
    const toBalance = parseFloat(user[toColumn] || 0);

    console.log('[EXCHANGE] Current balances:', {
      fromBalance,
      toBalance,
      fromColumn,
      toColumn
    });

    if (fromBalance < amountNum) {
      console.error('[EXCHANGE] Insufficient balance:', {
        fromBalance,
        amountNum,
        required: amountNum,
        available: fromBalance,
        deficit: amountNum - fromBalance
      });
      return new Response(
        JSON.stringify({ 
          error: "Insufficient balance", 
          balance: fromBalance, 
          required: amountNum,
          deficit: amountNum - fromBalance,
          currency: from_currency
        }),
        { 
          headers: { ...corsHeaders, "Content-Type": "application/json" }, 
          status: 400 
        }
      );
    }

    const newFromBalance = fromBalance - amountNum;
    const newToBalance = toBalance + (amountNum * rateNum);

    console.log('[EXCHANGE] Calculating new balances:', {
      fromBalance,
      amountNum,
      newFromBalance,
      toBalance,
      rateNum,
      amountToAdd: amountNum * rateNum,
      newToBalance
    });

    // Спробуємо використати RPC функцію для атомарного обміну
    try {
      console.log('[EXCHANGE] Attempting to use RPC function atomic_exchange with params:', {
        p_chat_id: chat_id,
        p_from_column: fromColumn,
        p_to_column: toColumn,
        p_amount: amountNum,
        p_exchange_rate: rateNum,
        p_new_from_balance: newFromBalance,
        p_new_to_balance: newToBalance
      });

      const { data: rpcResult, error: rpcError } = await supabase.rpc('atomic_exchange', {
        p_chat_id: typeof chat_id === 'string' ? parseInt(chat_id) : chat_id,
        p_from_column: fromColumn,
        p_to_column: toColumn,
        p_amount: amountNum,
        p_exchange_rate: rateNum,
        p_new_from_balance: newFromBalance,
        p_new_to_balance: newToBalance
      });

      console.log('[EXCHANGE] RPC function response:', {
        rpcError,
        rpcResult,
        hasError: !!rpcError,
        hasResult: !!rpcResult,
        resultType: typeof rpcResult,
        resultKeys: rpcResult ? Object.keys(rpcResult) : null
      });

      if (rpcError) {
        console.error('[EXCHANGE] RPC function error:', {
          error: rpcError,
          message: rpcError.message,
          details: rpcError.details,
          hint: rpcError.hint,
          code: rpcError.code,
          fullError: JSON.stringify(rpcError, Object.getOwnPropertyNames(rpcError))
        });
        // Продовжуємо до fallback
        throw new Error(`RPC_ERROR: ${rpcError.message || 'Unknown RPC error'}`);
      }

      if (rpcResult) {
        console.log('[EXCHANGE] RPC function result:', JSON.stringify(rpcResult));
        
        // Перевіряємо, чи результат є об'єктом з полем success
        if (typeof rpcResult === 'object' && rpcResult !== null) {
          if ('success' in rpcResult && rpcResult.success === false) {
            console.error('[EXCHANGE] RPC function returned error:', {
              error: rpcResult.error,
              details: rpcResult.details,
              fullResult: JSON.stringify(rpcResult)
            });
            return new Response(
              JSON.stringify({ 
                error: rpcResult.error || "Failed to process exchange",
                reason: "RPC function error",
                details: rpcResult.details || rpcResult
              }),
              { 
                headers: { ...corsHeaders, "Content-Type": "application/json" }, 
                status: 500 
              }
            );
          }

          if ('success' in rpcResult && rpcResult.success === true) {
            // RPC функція успішно виконана
            console.log('[EXCHANGE] RPC function completed successfully:', {
              newFromBalance: rpcResult.newFromBalance,
              newToBalance: rpcResult.newToBalance
            });
            
            // Оновлюємо значення з результату RPC для логування
            const finalFromBalance = rpcResult.newFromBalance || newFromBalance;
            const finalToBalance = rpcResult.newToBalance || newToBalance;
            
            // Логуємо транзакцію
            try {
              console.log('[EXCHANGE] Logging transaction to atomic_transactions table...');
              const { error: logError } = await supabase
                .from('atomic_transactions')
                .insert({
                  operation: 'exchange',
                  chat_id: chat_id,
                  amount: amountNum,
                  currency: `${from_currency}->${to_currency}`,
                  old_balance: fromBalance,
                  new_balance: finalFromBalance,
                  exchange_rate: rateNum,
                  status: 'success',
                  created_at: new Date().toISOString()
                });
              
              if (logError) {
                console.error('[EXCHANGE] Error logging transaction (non-critical):', logError);
              } else {
                console.log('[EXCHANGE] Transaction logged successfully');
              }
            } catch (logError) {
              console.error('[EXCHANGE] Exception while logging transaction (non-critical):', logError);
            }

            console.log('[EXCHANGE] Exchange completed successfully via RPC:', {
              chat_id,
              from_currency,
              to_currency,
              amount: amountNum,
              exchange_rate: rateNum,
              newFromBalance: finalFromBalance,
              newToBalance: finalToBalance
            });

            return new Response(
              JSON.stringify({ 
                success: true,
                operation: 'exchange',
                chat_id,
                from_currency,
                to_currency,
                amount: amountNum,
                exchange_rate: rateNum,
                newFromBalance: finalFromBalance,
                newToBalance: finalToBalance
              }),
              { 
                headers: { ...corsHeaders, "Content-Type": "application/json" } 
              }
            );
          } else {
            console.warn('[EXCHANGE] RPC result does not have success=true, using fallback');
            throw new Error('RPC_INVALID_RESULT');
          }
        } else {
          console.warn('[EXCHANGE] RPC result is not an object, using fallback');
          throw new Error('RPC_INVALID_RESULT');
        }
      } else {
        console.warn('[EXCHANGE] RPC function returned no result, using fallback');
        throw new Error('RPC_NO_RESULT');
      }
    } catch (rpcFallbackError: any) {
      console.log('[EXCHANGE] RPC function failed, reason:', {
        message: rpcFallbackError?.message,
        error: rpcFallbackError,
        stack: rpcFallbackError?.stack,
        name: rpcFallbackError?.name
      });
      // Fallback до оптимістичного блокування
      console.log('[EXCHANGE] Using optimistic locking fallback...');
      
      // Перевіряємо фактичні баланси перед оновленням (для діагностики)
      const { data: currentUserCheck } = await supabase
        .from('users')
        .select(`${fromColumn}, ${toColumn}`)
        .eq('chat_id', chat_id)
        .single();

      if (currentUserCheck) {
        const actualFrom = parseFloat(currentUserCheck[fromColumn] || 0);
        const actualTo = parseFloat(currentUserCheck[toColumn] || 0);
        
        console.log('[EXCHANGE] Current balances in DB before update:', {
          expected: { from: fromBalance, to: toBalance },
          actual: { from: actualFrom, to: actualTo },
          match: actualFrom === fromBalance && actualTo === toBalance
        });

        if (actualFrom !== fromBalance || actualTo !== toBalance) {
          console.error('[EXCHANGE] Balances changed between read and update:', {
            expected: { from: fromBalance, to: toBalance },
            actual: { from: actualFrom, to: actualTo },
            differences: {
              from: actualFrom - fromBalance,
              to: actualTo - toBalance
            }
          });
          return new Response(
            JSON.stringify({ 
              error: "Balance conflict, please retry",
              reason: "Balances changed during operation",
              expected: {
                [fromColumn]: fromBalance,
                [toColumn]: toBalance
              },
              actual: {
                [fromColumn]: actualFrom,
                [toColumn]: actualTo
              }
            }),
            { 
              headers: { ...corsHeaders, "Content-Type": "application/json" }, 
              status: 409 
            }
          );
        }
      }

      // Атомарно оновлюємо обидва баланси
      console.log('[EXCHANGE] Attempting to update balances with conditions:', {
        chat_id,
        [fromColumn]: fromBalance,
        [toColumn]: toBalance
      });

      const { data: updateData, error: updateError, count } = await supabase
        .from('users')
        .update({ 
          [fromColumn]: newFromBalance,
          [toColumn]: newToBalance
        })
        .eq('chat_id', chat_id)
        .eq(fromColumn, fromBalance) // Оптимістичне блокування
        .eq(toColumn, toBalance)
        .select();

      console.log('[EXCHANGE] Update result:', {
        updateError,
        updateData,
        rowsUpdated: count,
        hasError: !!updateError
      });

      if (updateError) {
        console.error('[EXCHANGE] Error updating balances:', {
          error: updateError,
          message: updateError.message,
          code: updateError.code,
          details: updateError.details,
          hint: updateError.hint
        });
        return new Response(
          JSON.stringify({ 
            error: "Failed to process exchange", 
            details: updateError.message,
            code: updateError.code,
            hint: updateError.hint
          }),
          { 
            headers: { ...corsHeaders, "Content-Type": "application/json" }, 
            status: 500 
          }
        );
      }

      // Перевіряємо, чи було оновлено хоча б один рядок
      if (!updateData || (Array.isArray(updateData) && updateData.length === 0)) {
        // Отримуємо актуальні баланси для діагностики
        const { data: diagnosticUser } = await supabase
          .from('users')
          .select(`${fromColumn}, ${toColumn}`)
          .eq('chat_id', chat_id)
          .single();

        console.error('[EXCHANGE] No rows updated - balance conflict detected:', {
          expectedFromBalance: fromBalance,
          expectedToBalance: toBalance,
          chat_id,
          actualBalances: diagnosticUser ? {
            [fromColumn]: diagnosticUser[fromColumn],
            [toColumn]: diagnosticUser[toColumn]
          } : 'User not found'
        });
        
        return new Response(
          JSON.stringify({ 
            error: "Balance conflict, please retry",
            reason: "Balances changed during operation - no rows were updated",
            expected: {
              [fromColumn]: fromBalance,
              [toColumn]: toBalance
            },
            actual: diagnosticUser ? {
              [fromColumn]: diagnosticUser[fromColumn],
              [toColumn]: diagnosticUser[toColumn]
            } : null
          }),
          { 
            headers: { ...corsHeaders, "Content-Type": "application/json" }, 
            status: 409 
          }
        );
      }

      // Перевіряємо, чи баланси дійсно оновилися
      console.log('[EXCHANGE] Verifying updated balances...');
      const { data: updatedUser, error: verifyError } = await supabase
        .from('users')
        .select(`${fromColumn}, ${toColumn}`)
        .eq('chat_id', chat_id)
        .single();

      if (verifyError) {
        console.error('[EXCHANGE] Error verifying balances:', verifyError);
      }

      if (updatedUser) {
        const updatedFrom = parseFloat(updatedUser[fromColumn] || 0);
        const updatedTo = parseFloat(updatedUser[toColumn] || 0);
        
        console.log('[EXCHANGE] Verification result:', {
          expected: { from: newFromBalance, to: newToBalance },
          actual: { from: updatedFrom, to: updatedTo },
          match: updatedFrom === newFromBalance && updatedTo === newToBalance
        });
        
        if (updatedFrom !== newFromBalance || updatedTo !== newToBalance) {
          console.error('[EXCHANGE] Balance mismatch after update:', {
            expected: { from: newFromBalance, to: newToBalance },
            actual: { from: updatedFrom, to: updatedTo },
            differences: {
              from: updatedFrom - newFromBalance,
              to: updatedTo - newToBalance
            }
          });
          return new Response(
            JSON.stringify({ 
              error: "Balance conflict, please retry",
              reason: "Balances did not match expected values after update",
              expected: {
                [fromColumn]: newFromBalance,
                [toColumn]: newToBalance
              },
              actual: {
                [fromColumn]: updatedFrom,
                [toColumn]: updatedTo
              }
            }),
            { 
              headers: { ...corsHeaders, "Content-Type": "application/json" }, 
              status: 409 
            }
          );
        }
      }
    }

    // Логуємо транзакцію
    try {
      console.log('[EXCHANGE] Logging transaction to atomic_transactions table...');
      const { error: logError } = await supabase
        .from('atomic_transactions')
        .insert({
          operation: 'exchange',
          chat_id: chat_id,
          amount: amountNum,
          currency: `${from_currency}->${to_currency}`,
          old_balance: fromBalance,
          new_balance: newFromBalance,
          exchange_rate: rateNum,
          status: 'success',
          created_at: new Date().toISOString()
        });
      
      if (logError) {
        console.error('[EXCHANGE] Error logging transaction (non-critical):', logError);
      } else {
        console.log('[EXCHANGE] Transaction logged successfully');
      }
    } catch (logError) {
      console.error('[EXCHANGE] Exception while logging transaction (non-critical):', logError);
    }

    console.log('[EXCHANGE] Exchange completed successfully:', {
      chat_id,
      from_currency,
      to_currency,
      amount: amountNum,
      exchange_rate: rateNum,
      newFromBalance,
      newToBalance
    });

    return new Response(
      JSON.stringify({ 
        success: true,
        operation: 'exchange',
        chat_id,
        from_currency,
        to_currency,
        amount: amountNum,
        exchange_rate: rateNum,
        newFromBalance,
        newToBalance
      }),
      { 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );
  } catch (error) {
    console.error('[EXCHANGE] Unexpected error in handleExchange:', {
      error,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      name: error instanceof Error ? error.name : undefined,
      cause: error instanceof Error ? error.cause : undefined,
      params: { chat_id, from_currency, to_currency, amount, exchange_rate },
      errorString: JSON.stringify(error, Object.getOwnPropertyNames(error))
    });
    return new Response(
      JSON.stringify({ 
        error: "Internal server error", 
        details: error instanceof Error ? error.message : String(error),
        operation: 'exchange',
        errorType: error instanceof Error ? error.name : typeof error
      }),
      { 
        headers: { ...corsHeaders, "Content-Type": "application/json" }, 
        status: 500 
      }
    );
  }
}

// Атомарне оновлення балансу та інвойсу (для crypto-bot-webhook)
async function handleUpdateInvoiceBalance(params: any) {
  const { chat_id, invoice_id, amount, currency } = params;

  if (!chat_id || !invoice_id || !amount || !currency) {
    return new Response(
      JSON.stringify({ error: "Missing required fields: chat_id, invoice_id, amount, currency" }),
      { 
        headers: { ...corsHeaders, "Content-Type": "application/json" }, 
        status: 400 
      }
    );
  }

  return await handleDeposit({ chat_id, amount, currency, invoice_id });
}

// Атомарне оновлення балансу та статусу трейду
async function handleUpdateTradeBalance(params: any) {
  console.log('[UPDATE-TRADE-BALANCE] Starting update trade balance operation');
  console.log('[UPDATE-TRADE-BALANCE] Raw params received:', JSON.stringify(params, null, 2));
  console.log('[UPDATE-TRADE-BALANCE] Params type:', typeof params);
  console.log('[UPDATE-TRADE-BALANCE] Params keys:', params ? Object.keys(params) : 'null');
  
  const { chat_id, trade_id, is_win, amount } = params;

  console.log('[UPDATE-TRADE-BALANCE] Received params:', {
    chat_id,
    chat_id_type: typeof chat_id,
    trade_id,
    trade_id_type: typeof trade_id,
    is_win,
    is_win_type: typeof is_win,
    amount,
    amount_type: typeof amount,
    params_keys: Object.keys(params)
  });

  // Перевіряємо наявність всіх обов'язкових полів
  const missingFields: string[] = [];
  const fieldChecks = {
    chat_id: chat_id === null || chat_id === undefined || chat_id === '',
    trade_id: trade_id === null || trade_id === undefined || trade_id === '',
    is_win: is_win === null || is_win === undefined,
    amount: amount === null || amount === undefined || amount === ''
  };

  if (fieldChecks.chat_id) missingFields.push('chat_id');
  if (fieldChecks.trade_id) missingFields.push('trade_id');
  if (fieldChecks.is_win) missingFields.push('is_win');
  if (fieldChecks.amount) missingFields.push('amount');

  if (missingFields.length > 0) {
    console.error('[UPDATE-TRADE-BALANCE] Missing required fields:', {
      missingFields,
      fieldChecks,
      receivedParams: params,
      paramsType: typeof params,
      paramsKeys: params ? Object.keys(params) : 'null',
      chat_id_value: chat_id,
      chat_id_type: typeof chat_id,
      trade_id_value: trade_id,
      trade_id_type: typeof trade_id,
      is_win_value: is_win,
      is_win_type: typeof is_win,
      amount_value: amount,
      amount_type: typeof amount
    });
    return new Response(
      JSON.stringify({ 
        error: "Missing required fields", 
        details: missingFields,
        fieldChecks,
        receivedParams: params
      }),
      { 
        headers: { ...corsHeaders, "Content-Type": "application/json" }, 
        status: 400 
      }
    );
  }

  // Конвертуємо amount до числа (може бути рядком або числом)
  const amountNum = typeof amount === 'number' ? amount : parseFloat(String(amount));
  if (isNaN(amountNum) || amountNum <= 0) {
    console.error('[UPDATE-TRADE-BALANCE] Invalid amount:', { 
      amount, 
      amountType: typeof amount,
      amountNum,
      isNaN: isNaN(amountNum),
      isPositive: amountNum > 0
    });
    return new Response(
      JSON.stringify({ 
        error: "Invalid amount", 
        amount,
        amountType: typeof amount,
        details: `Amount must be a positive number, got: ${amount} (${typeof amount})`
      }),
      { 
        headers: { ...corsHeaders, "Content-Type": "application/json" }, 
        status: 400 
      }
    );
  }

  const profitAmount = amountNum * 0.75; // 75% від тіла трейду (виграш)

  try {
    // Отримуємо поточний баланс та статус трейду
    console.log('[UPDATE-TRADE-BALANCE] Fetching user data for chat_id:', chat_id);
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('usdt_amount, id')
      .eq('chat_id', chat_id)
      .single();

    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "User not found" }),
        { 
          headers: { ...corsHeaders, "Content-Type": "application/json" }, 
          status: 404 
        }
      );
    }

    console.log('[UPDATE-TRADE-BALANCE] Fetching trade data for trade_id:', trade_id);
    const { data: trade, error: tradeError } = await supabase
      .from('trades')
      .select('isActive, amount')
      .eq('id', trade_id)
      .single();

    if (tradeError) {
      console.error('[UPDATE-TRADE-BALANCE] Error fetching trade:', {
        error: tradeError,
        message: tradeError.message,
        code: tradeError.code,
        details: tradeError.details,
        hint: tradeError.hint
      });
      return new Response(
        JSON.stringify({ 
          error: "Trade not found or database error",
          details: tradeError.message,
          code: tradeError.code
        }),
        { 
          headers: { ...corsHeaders, "Content-Type": "application/json" }, 
          status: 404 
        }
      );
    }

    if (!trade) {
      console.error('[UPDATE-TRADE-BALANCE] Trade not found for id:', trade_id);
      return new Response(
        JSON.stringify({ error: "Trade not found", trade_id }),
        { 
          headers: { ...corsHeaders, "Content-Type": "application/json" }, 
          status: 404 
        }
      );
    }

    // Не перевіряємо isActive тут - RPC функція сама обробить випадок, коли трейд вже закритий
    // Якщо трейд закритий, RPC функція оновить баланс, якщо результат правильний
    if (!trade.isActive) {
      console.warn('[UPDATE-TRADE-BALANCE] Trade is already closed, but will attempt to update balance:', trade_id);
    }

    const currentBalance = parseFloat(user.usdt_amount || 0);
    console.log('[UPDATE-TRADE-BALANCE] Current user balance:', {
      chat_id,
      usdt_amount: user.usdt_amount,
      currentBalance,
      userId: user.id
    });
    // Логіка обчислення балансу:
    // Якщо перемога: баланс = баланс + тіло трейду + 75% від тіла
    //   Приклад: тіло = 100, виграш = 75, новий баланс = баланс + 100 + 75 = баланс + 175
    // Якщо програш: баланс = баланс + 25% від тіла (тільки повернення, тіло не віднімається)
    //   Приклад: тіло = 100, повернення = 25, новий баланс = баланс + 25
    const refundAmount = amountNum * 0.25; // 25% від тіла при програші (повернення)
    const newBalance = is_win 
      ? currentBalance + amountNum + profitAmount  // тіло + 75% від тіла
      : currentBalance + refundAmount;  // тільки + 25% від тіла (повернення)

    // Перевіряємо, чи newBalance є валідним числом
    if (isNaN(newBalance) || !isFinite(newBalance)) {
      console.error('[UPDATE-TRADE-BALANCE] Invalid newBalance calculated:', {
        currentBalance,
        amountNum,
        profitAmount,
        refundAmount,
        is_win,
        newBalance
      });
      return new Response(
        JSON.stringify({ 
          error: "Invalid balance calculation result",
          details: `newBalance is ${newBalance}`
        }),
        { 
          headers: { ...corsHeaders, "Content-Type": "application/json" }, 
          status: 500 
        }
      );
    }

    console.log('[UPDATE-TRADE-BALANCE] Calculating new balance:', {
      currentBalance,
      amountNum,
      profitAmount,
      refundAmount: is_win ? 0 : refundAmount,
      is_win,
      newBalance,
      calculation: is_win 
        ? `${currentBalance} + ${amountNum} + ${profitAmount} = ${newBalance}`
        : `${currentBalance} + ${refundAmount} = ${newBalance}`
    });

    // Спробуємо використати RPC функцію для атомарного оновлення
    try {
      console.log('[UPDATE-TRADE-BALANCE] Attempting to use RPC function atomic_update_trade_balance...');
      // Конвертуємо параметри до правильних типів
      const pChatId = typeof chat_id === 'string' ? parseInt(chat_id, 10) : Number(chat_id);
      const pTradeId = typeof trade_id === 'string' ? parseInt(trade_id, 10) : Number(trade_id);
      const pIsWin = is_win === 'true' || is_win === true || is_win === 1 || is_win === '1';
      
      // Перевіряємо, чи параметри валідні
      if (isNaN(pChatId) || isNaN(pTradeId)) {
        console.error('[UPDATE-TRADE-BALANCE] Invalid chat_id or trade_id:', { chat_id, trade_id, pChatId, pTradeId });
        return new Response(
          JSON.stringify({ 
            error: "Invalid chat_id or trade_id",
            chat_id,
            trade_id
          }),
          { 
            headers: { ...corsHeaders, "Content-Type": "application/json" }, 
            status: 400 
          }
        );
      }

      const rpcParams = {
        p_chat_id: pChatId,
        p_trade_id: pTradeId,
        p_is_win: Boolean(pIsWin),
        p_amount: Number(amountNum),
        p_new_balance: Number(newBalance)
      };
      console.log('[UPDATE-TRADE-BALANCE] ===== BEFORE RPC CALL =====');
      console.log('[UPDATE-TRADE-BALANCE] RPC function parameters:', JSON.stringify(rpcParams, null, 2));
      console.log('[UPDATE-TRADE-BALANCE] Current balance before RPC:', currentBalance);
      console.log('[UPDATE-TRADE-BALANCE] New balance to set:', newBalance);
      console.log('[UPDATE-TRADE-BALANCE] Calling supabase.rpc("atomic_update_trade_balance", ...)');
      
      const rpcStartTime = Date.now();
      const { data: rpcResult, error: rpcError } = await supabase.rpc('atomic_update_trade_balance', rpcParams);
      const rpcEndTime = Date.now();
      
      console.log('[UPDATE-TRADE-BALANCE] ===== AFTER RPC CALL =====');
      console.log('[UPDATE-TRADE-BALANCE] RPC call duration:', rpcEndTime - rpcStartTime, 'ms');

      console.log('[UPDATE-TRADE-BALANCE] RPC function response:', {
        rpcError,
        rpcResult,
        hasError: !!rpcError,
        hasResult: !!rpcResult,
        resultType: typeof rpcResult,
        resultKeys: rpcResult ? Object.keys(rpcResult) : null
      });

      if (rpcError) {
        console.error('[UPDATE-TRADE-BALANCE] RPC function error:', {
          error: rpcError,
          message: rpcError.message,
          details: rpcError.details,
          hint: rpcError.hint,
          code: rpcError.code,
          fullError: JSON.stringify(rpcError, Object.getOwnPropertyNames(rpcError))
        });
        
        // Якщо RPC функція не існує або є критична помилка - не використовуємо fallback
        if (rpcError.message && (
          rpcError.message.includes('function') && rpcError.message.includes('does not exist') ||
          rpcError.message.includes('permission denied') ||
          rpcError.code === '42883' // function does not exist
        )) {
          console.error('[UPDATE-TRADE-BALANCE] RPC function does not exist or permission denied, cannot use fallback');
          return new Response(
            JSON.stringify({ 
              error: "RPC function error", 
              details: rpcError.message,
              code: rpcError.code
            }),
            { 
              headers: { ...corsHeaders, "Content-Type": "application/json" }, 
              status: 500 
            }
          );
        }
        
        // Продовжуємо до fallback
        throw new Error(`RPC_ERROR: ${rpcError.message || 'Unknown RPC error'}`);
      }

      if (rpcResult) {
        console.log('[UPDATE-TRADE-BALANCE] RPC function result:', JSON.stringify(rpcResult));
        
        if (typeof rpcResult === 'object' && rpcResult !== null) {
          if ('success' in rpcResult && rpcResult.success === false) {
            console.error('[UPDATE-TRADE-BALANCE] RPC function returned error:', {
              error: rpcResult.error,
              sqlstate: rpcResult.sqlstate,
              fullResult: rpcResult,
              params: rpcParams
            });
            
            // Якщо трейд вже закритий з іншим результатом - це помилка
            if (rpcResult.error && rpcResult.error.includes('already closed with different result')) {
              return new Response(
                JSON.stringify({ 
                  success: false,
                  error: rpcResult.error,
                  details: rpcResult
                }),
                { 
                  headers: { ...corsHeaders, "Content-Type": "application/json" }, 
                  status: 400 
                }
              );
            }
            
            // Якщо трейд вже закритий - RPC функція має обробити це і оновити баланс
            // Якщо ми тут, значить щось пішло не так
            if (rpcResult.error && rpcResult.error.includes('already closed')) {
              console.warn('[UPDATE-TRADE-BALANCE] Trade is already closed, but RPC did not update balance');
              // Спробуємо fallback
              throw new Error(`RPC_ERROR: ${rpcResult.error || 'Unknown RPC error'}`);
            }
            
            // Спробуємо fallback, якщо це не критична помилка
            if (rpcResult.error && rpcResult.error.includes('not found')) {
              // Це помилка валідації, не спробуємо fallback
              return new Response(
                JSON.stringify({ 
                  error: rpcResult.error || "Failed to update trade balance",
                  reason: "RPC function validation error",
                  details: rpcResult
                }),
                { 
                  headers: { ...corsHeaders, "Content-Type": "application/json" }, 
                  status: 400 
                }
              );
            }
            // Для інших помилок спробуємо fallback
            throw new Error(`RPC_ERROR: ${rpcResult.error || 'Unknown RPC error'}`);
          }

          if ('success' in rpcResult && rpcResult.success === true) {
            // RPC функція успішно виконана
            console.log('[UPDATE-TRADE-BALANCE] RPC function completed successfully:', {
              newBalance: rpcResult.newBalance,
              alreadyClosed: rpcResult.alreadyClosed || false
            });
            
            const finalBalance = rpcResult.newBalance || newBalance;
            
            // Перевіряємо, чи баланс дійсно оновився
            console.log('[UPDATE-TRADE-BALANCE] Verifying balance update...');
            const { data: verifyUser } = await supabase
              .from('users')
              .select('usdt_amount')
              .eq('chat_id', chat_id)
              .single();
            
            if (verifyUser) {
              const actualBalance = parseFloat(verifyUser.usdt_amount || 0);
              console.log('[UPDATE-TRADE-BALANCE] Balance verification:', {
                expected: finalBalance,
                actual: actualBalance,
                difference: Math.abs(actualBalance - finalBalance),
                match: Math.abs(actualBalance - finalBalance) < 0.01
              });
              
              if (Math.abs(actualBalance - finalBalance) >= 0.01) {
                console.error('[UPDATE-TRADE-BALANCE] Balance mismatch after RPC update!', {
                  expected: finalBalance,
                  actual: actualBalance,
                  difference: actualBalance - finalBalance
                });
              }
            }
            
            // Логуємо транзакцію
            try {
              console.log('[UPDATE-TRADE-BALANCE] Logging transaction to atomic_transactions table...');
              const { error: logError } = await supabase
                .from('atomic_transactions')
                .insert({
                  operation: 'update_trade_balance',
                  chat_id: chat_id,
                  amount: amountNum,
                  currency: 'USDT',
                  old_balance: currentBalance,
                  new_balance: finalBalance,
                  trade_id: trade_id,
                  is_win: is_win,
                  status: 'success',
                  created_at: new Date().toISOString()
                });
              
              if (logError) {
                console.error('[UPDATE-TRADE-BALANCE] Error logging transaction (non-critical):', logError);
              } else {
                console.log('[UPDATE-TRADE-BALANCE] Transaction logged successfully');
              }
            } catch (logError) {
              console.error('[UPDATE-TRADE-BALANCE] Exception while logging transaction (non-critical):', logError);
            }

            console.log('[UPDATE-TRADE-BALANCE] Trade balance update completed successfully via RPC');

            return new Response(
              JSON.stringify({ 
                success: true,
                operation: 'update_trade_balance',
                chat_id,
                trade_id,
                is_win,
                newBalance: finalBalance
              }),
              { 
                headers: { ...corsHeaders, "Content-Type": "application/json" } 
              }
            );
          } else {
            console.warn('[UPDATE-TRADE-BALANCE] RPC result does not have success=true, using fallback');
            throw new Error('RPC_INVALID_RESULT');
          }
        } else {
          console.warn('[UPDATE-TRADE-BALANCE] RPC result is not an object, using fallback');
          throw new Error('RPC_INVALID_RESULT');
        }
      } else {
        console.warn('[UPDATE-TRADE-BALANCE] RPC function returned no result, using fallback');
        throw new Error('RPC_NO_RESULT');
      }
    } catch (rpcFallbackError: any) {
      console.log('[UPDATE-TRADE-BALANCE] RPC function failed, using optimistic locking fallback:', {
        error: rpcFallbackError,
        message: rpcFallbackError?.message,
        stack: rpcFallbackError?.stack
      });
      
      // Fallback до оптимістичного блокування
      // Використовуємо більш агресивну стратегію - кілька спроб з актуальним балансом
      let fallbackSuccess = false;
      let lastError: any = null;
      const fallbackMaxRetries = 3;
      
      for (let fallbackRetry = 0; fallbackRetry < fallbackMaxRetries; fallbackRetry++) {
        console.log(`[UPDATE-TRADE-BALANCE] Fallback attempt ${fallbackRetry + 1}/${fallbackMaxRetries}...`);
        
        // Отримуємо актуальний баланс для кожної спроби
        const { data: currentUserData, error: currentUserError } = await supabase
          .from('users')
          .select('usdt_amount')
          .eq('chat_id', chat_id)
          .single();
        
        if (currentUserError || !currentUserData) {
          console.error(`[UPDATE-TRADE-BALANCE] Error fetching current balance for fallback attempt ${fallbackRetry + 1}:`, currentUserError);
          lastError = currentUserError;
          if (fallbackRetry < fallbackMaxRetries - 1) {
            await new Promise(resolve => setTimeout(resolve, 200 * (fallbackRetry + 1)));
            continue;
          }
          break;
        }
        
        const fallbackCurrentBalance = parseFloat(currentUserData.usdt_amount || 0);
        
        // Перераховуємо newBalance відносно актуального балансу
        const fallbackNewBalance = is_win 
          ? fallbackCurrentBalance + amountNum + profitAmount
          : fallbackCurrentBalance + refundAmount;
        
        console.log(`[UPDATE-TRADE-BALANCE] Fallback attempt ${fallbackRetry + 1} - balance calculation:`, {
          is_win,
          fallbackCurrentBalance,
          amountNum,
          profitAmount,
          refundAmount,
          fallbackNewBalance
        });
        
        // Спробуємо оновити баланс
        try {
          console.log(`[UPDATE-TRADE-BALANCE] ===== FALLBACK ATTEMPT ${fallbackRetry + 1} - BEFORE UPDATE =====`);
          console.log(`[UPDATE-TRADE-BALANCE] Attempting to update users table:`, {
            chat_id,
            currentBalance: fallbackCurrentBalance,
            newBalance: fallbackNewBalance,
            updateQuery: `UPDATE users SET usdt_amount = ${fallbackNewBalance} WHERE chat_id = ${chat_id} AND usdt_amount = ${fallbackCurrentBalance}`
          });
          
          const updateStartTime = Date.now();
          const balanceResult = await supabase
            .from('users')
            .update({ usdt_amount: fallbackNewBalance })
            .eq('chat_id', chat_id)
            .eq('usdt_amount', fallbackCurrentBalance) // Оптимістичне блокування з актуальним балансом
            .select();
          const updateEndTime = Date.now();
          
          console.log(`[UPDATE-TRADE-BALANCE] ===== FALLBACK ATTEMPT ${fallbackRetry + 1} - AFTER UPDATE =====`);
          console.log(`[UPDATE-TRADE-BALANCE] Update duration:`, updateEndTime - updateStartTime, 'ms');
          console.log(`[UPDATE-TRADE-BALANCE] Update result:`, {
            error: balanceResult.error,
            errorMessage: balanceResult.error?.message,
            errorCode: balanceResult.error?.code,
            errorDetails: balanceResult.error?.details,
            errorHint: balanceResult.error?.hint,
            data: balanceResult.data,
            dataType: typeof balanceResult.data,
            isArray: Array.isArray(balanceResult.data),
            dataLength: Array.isArray(balanceResult.data) ? balanceResult.data.length : (balanceResult.data ? 1 : 0)
          });
          
          const userRowsUpdated = Array.isArray(balanceResult.data) ? balanceResult.data.length : (balanceResult.data ? 1 : 0);
          console.log(`[UPDATE-TRADE-BALANCE] Rows updated:`, userRowsUpdated);
          
          if (balanceResult.error) {
            console.error(`[UPDATE-TRADE-BALANCE] Error updating balance in fallback attempt ${fallbackRetry + 1}:`, balanceResult.error);
            lastError = balanceResult.error;
            if (fallbackRetry < fallbackMaxRetries - 1) {
              await new Promise(resolve => setTimeout(resolve, 200 * (fallbackRetry + 1)));
              continue;
            }
            break;
          }
          
          if (userRowsUpdated === 0) {
            console.warn(`[UPDATE-TRADE-BALANCE] No rows updated in fallback attempt ${fallbackRetry + 1}, balance may have changed`);
            if (fallbackRetry < fallbackMaxRetries - 1) {
              await new Promise(resolve => setTimeout(resolve, 200 * (fallbackRetry + 1)));
              continue;
            }
            break;
          }
          
          // Баланс оновлено успішно, тепер оновлюємо трейд
          console.log(`[UPDATE-TRADE-BALANCE] Balance updated successfully in fallback attempt ${fallbackRetry + 1}`);
          
          // Перевіряємо фактичний баланс після оновлення
          const { data: verifyAfterUpdate } = await supabase
            .from('users')
            .select('usdt_amount')
            .eq('chat_id', chat_id)
            .single();
          
          console.log(`[UPDATE-TRADE-BALANCE] Balance verification after update:`, {
            expected: fallbackNewBalance,
            actual: verifyAfterUpdate ? parseFloat(verifyAfterUpdate.usdt_amount || 0) : null,
            match: verifyAfterUpdate ? Math.abs(parseFloat(verifyAfterUpdate.usdt_amount || 0) - fallbackNewBalance) < 0.01 : false
          });
          
          console.log(`[UPDATE-TRADE-BALANCE] ===== BEFORE TRADE UPDATE =====`);
          console.log(`[UPDATE-TRADE-BALANCE] Attempting to update trades table:`, {
            trade_id,
            isActive: false,
            isWin: is_win,
            updateQuery: `UPDATE trades SET isActive = false, isWin = ${is_win} WHERE id = ${trade_id}`
          });
          
          const tradeUpdateStartTime = Date.now();
          const tradeResult = await supabase
            .from('trades')
            .update({ isActive: false, isWin: is_win })
            .eq('id', trade_id)
            .select();
          const tradeUpdateEndTime = Date.now();
          
          console.log(`[UPDATE-TRADE-BALANCE] ===== AFTER TRADE UPDATE =====`);
          console.log(`[UPDATE-TRADE-BALANCE] Trade update duration:`, tradeUpdateEndTime - tradeUpdateStartTime, 'ms');
          console.log('[UPDATE-TRADE-BALANCE] Trade update result:', {
            error: tradeResult.error,
            errorMessage: tradeResult.error?.message,
            errorCode: tradeResult.error?.code,
            errorDetails: tradeResult.error?.details,
            data: tradeResult.data,
            dataType: typeof tradeResult.data,
            isArray: Array.isArray(tradeResult.data),
            dataLength: Array.isArray(tradeResult.data) ? tradeResult.data.length : (tradeResult.data ? 1 : 0)
          });
          
          // Навіть якщо трейд не оновився (вже закритий), баланс оновлено - це успіх
          fallbackSuccess = true;
          break;
          
        } catch (updateError: any) {
          console.error(`[UPDATE-TRADE-BALANCE] Exception in fallback attempt ${fallbackRetry + 1}:`, updateError);
          lastError = updateError;
          if (fallbackRetry < fallbackMaxRetries - 1) {
            await new Promise(resolve => setTimeout(resolve, 200 * (fallbackRetry + 1)));
            continue;
          }
          break;
        }
      }
      
      if (!fallbackSuccess) {
        // Остання спроба - просто оновлюємо баланс без перевірки старого значення
        console.log('[UPDATE-TRADE-BALANCE] ===== LAST RESORT - DIRECT UPDATE =====');
        console.log('[UPDATE-TRADE-BALANCE] All fallback attempts failed, trying direct update without balance check...');
        
        const { data: finalUserData, error: finalUserError } = await supabase
          .from('users')
          .select('usdt_amount')
          .eq('chat_id', chat_id)
          .single();
        
        console.log('[UPDATE-TRADE-BALANCE] Final user data fetch:', {
          error: finalUserError,
          data: finalUserData,
          usdt_amount: finalUserData?.usdt_amount
        });
        
        if (finalUserData) {
          const finalCurrentBalance = parseFloat(finalUserData.usdt_amount || 0);
          const finalNewBalance = is_win 
            ? finalCurrentBalance + amountNum + profitAmount
            : finalCurrentBalance + refundAmount;
          
          console.log('[UPDATE-TRADE-BALANCE] Direct update calculation:', {
            finalCurrentBalance,
            finalNewBalance,
            is_win,
            amountNum,
            profitAmount,
            refundAmount
          });
          
          console.log('[UPDATE-TRADE-BALANCE] ===== BEFORE DIRECT UPDATE =====');
          console.log('[UPDATE-TRADE-BALANCE] Direct update query:', `UPDATE users SET usdt_amount = ${finalNewBalance} WHERE chat_id = ${chat_id}`);
          
          const directUpdateStartTime = Date.now();
          const directUpdateResult = await supabase
            .from('users')
            .update({ usdt_amount: finalNewBalance })
            .eq('chat_id', chat_id)
            .select();
          const directUpdateEndTime = Date.now();
          
          console.log('[UPDATE-TRADE-BALANCE] ===== AFTER DIRECT UPDATE =====');
          console.log('[UPDATE-TRADE-BALANCE] Direct update duration:', directUpdateEndTime - directUpdateStartTime, 'ms');
          console.log('[UPDATE-TRADE-BALANCE] Direct update result:', {
            error: directUpdateResult.error,
            errorMessage: directUpdateResult.error?.message,
            errorCode: directUpdateResult.error?.code,
            data: directUpdateResult.data,
            dataLength: Array.isArray(directUpdateResult.data) ? directUpdateResult.data.length : (directUpdateResult.data ? 1 : 0)
          });
          
          if (directUpdateResult.data && (Array.isArray(directUpdateResult.data) ? directUpdateResult.data.length > 0 : directUpdateResult.data)) {
            console.log('[UPDATE-TRADE-BALANCE] Direct update succeeded!');
            
            // Перевіряємо фактичний баланс
            const { data: verifyDirect } = await supabase
              .from('users')
              .select('usdt_amount')
              .eq('chat_id', chat_id)
              .single();
            
            console.log('[UPDATE-TRADE-BALANCE] Balance after direct update:', {
              expected: finalNewBalance,
              actual: verifyDirect ? parseFloat(verifyDirect.usdt_amount || 0) : null
            });
            
            fallbackSuccess = true;
            
            // Оновлюємо трейд
            console.log('[UPDATE-TRADE-BALANCE] Updating trade after direct balance update...');
            const finalTradeUpdate = await supabase
              .from('trades')
              .update({ isActive: false, isWin: is_win })
              .eq('id', trade_id)
              .select();
            
            console.log('[UPDATE-TRADE-BALANCE] Final trade update result:', {
              error: finalTradeUpdate.error,
              data: finalTradeUpdate.data
            });
          } else {
            console.error('[UPDATE-TRADE-BALANCE] Direct update failed - no rows updated');
          }
        } else {
          console.error('[UPDATE-TRADE-BALANCE] Cannot perform direct update - user data not found');
        }
      }
      
      if (!fallbackSuccess) {
        console.error('[UPDATE-TRADE-BALANCE] All fallback attempts failed:', lastError);
        return new Response(
          JSON.stringify({ 
            error: "Failed to update balance after all retries", 
            details: lastError?.message || String(lastError)
          }),
          { 
            headers: { ...corsHeaders, "Content-Type": "application/json" }, 
            status: 500 
          }
        );
      }
      
      // Отримуємо фінальний баланс для логування
      const { data: finalUserData } = await supabase
        .from('users')
        .select('usdt_amount')
        .eq('chat_id', chat_id)
        .single();
      
      const finalBalance = finalUserData ? parseFloat(finalUserData.usdt_amount || 0) : newBalance;
      
      // Логуємо транзакцію після успішного fallback
      try {
        console.log('[UPDATE-TRADE-BALANCE] Logging transaction to atomic_transactions table...');
        const { error: logError } = await supabase
          .from('atomic_transactions')
          .insert({
            operation: 'update_trade_balance',
            chat_id: chat_id,
            amount: amountNum,
            currency: 'USDT',
            old_balance: currentBalance,
            new_balance: finalBalance,
            trade_id: trade_id,
            is_win: is_win,
            status: 'success',
            created_at: new Date().toISOString()
          });
        
        if (logError) {
          console.error('[UPDATE-TRADE-BALANCE] Error logging transaction (non-critical):', logError);
        } else {
          console.log('[UPDATE-TRADE-BALANCE] Transaction logged successfully');
        }
      } catch (logError) {
        console.error('[UPDATE-TRADE-BALANCE] Exception while logging transaction (non-critical):', logError);
      }
      
      return new Response(
        JSON.stringify({ 
          success: true,
          operation: 'update_trade_balance',
          chat_id,
          trade_id,
          is_win,
          newBalance: finalBalance,
          usedFallback: true
        }),
        { 
          headers: { ...corsHeaders, "Content-Type": "application/json" } 
        }
      );
    }
  } catch (error) {
    console.error('[UPDATE-TRADE-BALANCE] Unexpected error in handleUpdateTradeBalance:', {
      error,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      name: error instanceof Error ? error.name : undefined,
      cause: error instanceof Error ? error.cause : undefined,
      params: { chat_id, trade_id, is_win, amount },
      errorString: JSON.stringify(error, Object.getOwnPropertyNames(error))
    });
    return new Response(
      JSON.stringify({ 
        error: "Internal server error", 
        details: error instanceof Error ? error.message : String(error),
        operation: 'update_trade_balance',
        errorType: error instanceof Error ? error.name : typeof error
      }),
      { 
        headers: { ...corsHeaders, "Content-Type": "application/json" }, 
        status: 500 
      }
    );
  }
}


// Атомарна обробка депозиту (для адмін панелі)
async function handleProcessDeposit(params: any) {
  const { chat_id, amount, currency, deposit_id } = params;

  if (!chat_id || !amount || !currency || !deposit_id) {
    return new Response(
      JSON.stringify({ error: "Missing required fields: chat_id, amount, currency, deposit_id" }),
      { 
        headers: { ...corsHeaders, "Content-Type": "application/json" }, 
        status: 400 
      }
    );
  }

  return await handleDeposit({ chat_id, amount, currency, invoice_id: deposit_id });
}

// Атомарное создание бинарного опциона
async function handleCreateBinaryOption(params: any) {
  const { chat_id, token, direction, amount, entry_price, expiration_time } = params;

  if (!chat_id || !token || !direction || !amount || !entry_price || !expiration_time) {
    return new Response(
      JSON.stringify({ error: "Missing required fields: chat_id, token, direction, amount, entry_price, expiration_time" }),
      { 
        headers: { ...corsHeaders, "Content-Type": "application/json" }, 
        status: 400 
      }
    );
  }

  if (direction !== 'up' && direction !== 'down') {
    return new Response(
      JSON.stringify({ error: "Invalid direction. Must be 'up' or 'down'" }),
      { 
        headers: { ...corsHeaders, "Content-Type": "application/json" }, 
        status: 400 
      }
    );
  }

  const amountNum = parseFloat(amount);
  const entryPriceNum = parseFloat(entry_price);
  const expirationTimeNum = parseInt(expiration_time);

  if (isNaN(amountNum) || amountNum <= 0) {
    return new Response(
      JSON.stringify({ error: "Invalid amount" }),
      { 
        headers: { ...corsHeaders, "Content-Type": "application/json" }, 
        status: 400 
      }
    );
  }

  if (isNaN(entryPriceNum) || entryPriceNum <= 0) {
    return new Response(
      JSON.stringify({ error: "Invalid entry price" }),
      { 
        headers: { ...corsHeaders, "Content-Type": "application/json" }, 
        status: 400 
      }
    );
  }

  if (isNaN(expirationTimeNum) || expirationTimeNum <= 0) {
    return new Response(
      JSON.stringify({ error: "Invalid expiration time" }),
      { 
        headers: { ...corsHeaders, "Content-Type": "application/json" }, 
        status: 400 
      }
    );
  }

  try {
    // Получаем текущий баланс
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('rub_amount, id')
      .eq('chat_id', chat_id)
      .single();

    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "User not found" }),
        { 
          headers: { ...corsHeaders, "Content-Type": "application/json" }, 
          status: 404 
        }
      );
    }

    const currentBalance = parseFloat(user.rub_amount || 0);
    const newBalance = currentBalance - amountNum;

    if (newBalance < 0) {
      return new Response(
        JSON.stringify({ error: "Insufficient balance" }),
        { 
          headers: { ...corsHeaders, "Content-Type": "application/json" }, 
          status: 400 
        }
      );
    }

    // Атомарно создаем опцион и списываем баланс
    try {
      // Сначала создаем опцион
      const { data: optionData, error: optionError } = await supabase
        .from('binary_options')
        .insert({
          chat_id: chat_id,
          token: token,
          direction: direction,
          amount: amountNum,
          entry_price: entryPriceNum,
          expiration_time: expirationTimeNum,
          status: 'active',
          created_at: new Date().toISOString()
        })
        .select()
        .single();

      if (optionError) {
        throw optionError;
      }

      // Затем обновляем баланс с оптимистичным блокированием
      const { data: updateData, error: updateError } = await supabase
        .from('users')
        .update({ rub_amount: newBalance })
        .eq('chat_id', chat_id)
        .eq('rub_amount', currentBalance) // Оптимистичное блокирование
        .select()
        .single();

      if (updateError || !updateData) {
        // Если баланс не обновился, удаляем созданный опцион
        await supabase
          .from('binary_options')
          .delete()
          .eq('id', optionData.id);

        // Проверяем, изменился ли баланс
        const { data: checkUser } = await supabase
          .from('users')
          .select('rub_amount')
          .eq('chat_id', chat_id)
          .single();

        if (checkUser && parseFloat(checkUser.rub_amount || 0) !== currentBalance) {
          return new Response(
            JSON.stringify({ error: "Balance conflict, please retry" }),
            { 
              headers: { ...corsHeaders, "Content-Type": "application/json" }, 
              status: 409 
            }
          );
        }

        throw new Error("Failed to update balance");
      }

      // Логируем транзакцию
      try {
        await supabase
          .from('atomic_transactions')
          .insert({
            operation: 'create_binary_option',
            chat_id: chat_id,
            amount: amountNum,
            currency: 'RUB',
            old_balance: currentBalance,
            new_balance: newBalance,
            status: 'success',
            created_at: new Date().toISOString()
          });
      } catch (logError) {
        console.error('Error logging transaction:', logError);
      }

      return new Response(
        JSON.stringify({ 
          success: true,
          operation: 'create_binary_option',
          chat_id,
          option_id: optionData.id,
          amount: amountNum,
          newBalance
        }),
        { 
          headers: { ...corsHeaders, "Content-Type": "application/json" } 
        }
      );
    } catch (operationError) {
      console.error('Error in create binary option operation:', operationError);
      return new Response(
        JSON.stringify({ 
          error: "Failed to create binary option", 
          details: operationError instanceof Error ? operationError.message : String(operationError) 
        }),
        { 
          headers: { ...corsHeaders, "Content-Type": "application/json" }, 
          status: 500 
        }
      );
    }
  } catch (error) {
    console.error('Error in handleCreateBinaryOption:', error);
    return new Response(
      JSON.stringify({ error: "Internal server error", details: error instanceof Error ? error.message : String(error) }),
      { 
        headers: { ...corsHeaders, "Content-Type": "application/json" }, 
        status: 500 
      }
    );
  }
}

// Функція для відправки повідомлення про створення заявки на вивід
async function sendWithdrawNotification(chat_id: number, withdraw_id: number, amount: number, currency: string) {
  try {
    const botToken = Deno.env.get("BOT_TOKEN2");
    if (!botToken) {
      console.warn('[WITHDRAW] BOT_TOKEN not set, skipping notification');
      return;
    }

    // Отримуємо інформацію про withdraw
    const { data: withdraw, error: withdrawError } = await supabase
      .from('withdraws')
      .select('*')
      .eq('id', withdraw_id)
      .single();

    if (withdrawError || !withdraw) {
      console.error('[WITHDRAW] Error fetching withdraw data:', withdrawError);
      return;
    }

    // Отримуємо інформацію про користувача
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('chat_id', chat_id)
      .single();

    if (userError || !user) {
      console.error('[WITHDRAW] Error fetching user data:', userError);
      return;
    }

    // Отримуємо інформацію про worker
    const { data: worker, error: workerError } = await supabase
      .from('users')
      .select('*')
      .eq('chat_id', user.ref_id)
      .single();

    if (workerError || !worker) {
      console.error('[WITHDRAW] Error fetching worker data:', workerError);
      return;
    }

    const bot = new Bot(botToken);
    const keyboard = new InlineKeyboard()
      .text('Details', `details ${chat_id}`)
      .row()
      .text('Повернути назад', `back ${chat_id} ${amount} ${currency} ${withdraw_id}`);

    const message = `Новий вивід:
  Сума: ${amount}
  Номер картки: ${withdraw.card_number}
  Ім'я: ${withdraw.name}
  Користувач: @${user?.username || 'Unknown'}
  Worker: @${worker?.username || 'Unknown'} 
  Worker name: ${worker?.first_name || 'Unknown'}`;

    // Відправляємо повідомлення worker
    await bot.api.sendMessage(user.ref_id, message, {
      reply_markup: keyboard
    });

    // Відправляємо повідомлення адмінам
    const adminIds = ['7561947088', '7184660397', '6993432791'];
    for (const adminId of adminIds) {
      try {
        await bot.api.sendMessage(adminId, message, {
          reply_markup: keyboard
        });
      } catch (adminError) {
        console.error(`[WITHDRAW] Error sending message to admin ${adminId}:`, adminError);
      }
    }

    console.log('[WITHDRAW] Withdraw notification sent successfully');
  } catch (error) {
    console.error('[WITHDRAW] Error in sendWithdrawNotification:', error);
    throw error;
  }
}

