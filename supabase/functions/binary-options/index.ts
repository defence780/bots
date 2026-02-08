import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { chat_id, token, direction, amount, entry_price, expiration_time } = await req.json();

    // Валідація вхідних даних
    if (!chat_id || !token || !direction || !amount || !entry_price || !expiration_time) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }, 
          status: 400 
        }
      );
    }

    if (direction !== 'up' && direction !== 'down') {
      return new Response(
        JSON.stringify({ error: 'Direction must be "up" or "down"' }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }, 
          status: 400 
        }
      );
    }

    const amountNum = parseFloat(amount);
    const entryPriceNum = parseFloat(entry_price);
    const expirationTimeNum = parseInt(expiration_time);

    if (isNaN(amountNum) || amountNum <= 0) {
      return new Response(
        JSON.stringify({ error: 'Amount must be a positive number' }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }, 
          status: 400 
        }
      );
    }

    if (isNaN(entryPriceNum) || entryPriceNum <= 0) {
      return new Response(
        JSON.stringify({ error: 'Entry price must be a positive number' }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }, 
          status: 400 
        }
      );
    }

    if (isNaN(expirationTimeNum) || expirationTimeNum <= 0) {
      return new Response(
        JSON.stringify({ error: 'Expiration time must be a positive number' }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }, 
          status: 400 
        }
      );
    }

    // Отримуємо поточний баланс користувача
    const { data: user, error: userError } = await supabaseClient
      .from('users')
      .select('rub_amount, id')
      .eq('chat_id', chat_id)
      .single();

    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'User not found' }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }, 
          status: 404 
        }
      );
    }

    const currentBalance = parseFloat(user.rub_amount || 0);
    const newBalance = currentBalance - amountNum;

    if (newBalance < 0) {
      return new Response(
        JSON.stringify({ error: 'Insufficient balance' }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }, 
          status: 400 
        }
      );
    }

    // Атомарно створюємо опціон і списуємо баланс
    try {
      // Спочатку створюємо опціон
      const { data: optionData, error: optionError } = await supabaseClient
        .from('binary_options')
        .insert({
          chat_id: chat_id,
          token: token,
          direction: direction,
          amount: amountNum,
          entry_price: entryPriceNum,
          current_price: entryPriceNum, // Поточна ціна = вхідна ціна при створенні
          expiration_time: expirationTimeNum,
          status: 'active',
          created_at: new Date().toISOString(),
          last_checked_at: new Date().toISOString()
        })
        .select()
        .single();

      if (optionError) {
        throw optionError;
      }

      // Потім оновлюємо баланс з оптимістичним блокуванням
      const { data: updateData, error: updateError } = await supabaseClient
        .from('users')
        .update({ rub_amount: newBalance })
        .eq('chat_id', chat_id)
        .eq('rub_amount', currentBalance) // Оптимістичне блокування
        .select()
        .single();

      if (updateError || !updateData) {
        // Якщо баланс не оновився, видаляємо створений опціон
        await supabaseClient
          .from('binary_options')
          .delete()
          .eq('id', optionData.id);

        // Перевіряємо, чи змінився баланс
        const { data: checkUser } = await supabaseClient
          .from('users')
          .select('rub_amount')
          .eq('chat_id', chat_id)
          .single();

        if (checkUser && parseFloat(checkUser.rub_amount || 0) !== currentBalance) {
          return new Response(
            JSON.stringify({ error: 'Balance conflict, please retry' }),
            { 
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }, 
              status: 409 
            }
          );
        }

        throw new Error('Failed to update balance');
      }

      // Логуємо транзакцію
      try {
        await supabaseClient
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
          newBalance,
          option: optionData
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    } catch (operationError) {
      console.error('Error in create binary option operation:', operationError);
      return new Response(
        JSON.stringify({ 
          error: 'Failed to create binary option', 
          details: operationError instanceof Error ? operationError.message : String(operationError) 
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }, 
          status: 500 
        }
      );
    }
  } catch (error) {
    console.error('Error in binary-options function:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error', 
        details: error instanceof Error ? error.message : String(error) 
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, 
        status: 500 
      }
    );
  }
});
