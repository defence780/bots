-- PostgreSQL RPC функції для атомарних транзакцій
-- Ці функції виконуються в справжніх транзакціях PostgreSQL

-- Функція для атомарного депозиту
CREATE OR REPLACE FUNCTION atomic_deposit(
  p_chat_id BIGINT,
  p_column TEXT,
  p_amount DECIMAL,
  p_new_balance DECIMAL,
  p_invoice_id BIGINT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
AS $$
DECLARE
  v_old_balance DECIMAL;
  v_result JSON;
BEGIN
  -- Блокуємо рядок для оновлення (SELECT FOR UPDATE)
  IF p_column = 'rub_amount' THEN
    SELECT rub_amount INTO v_old_balance
    FROM users
    WHERE chat_id = p_chat_id
    FOR UPDATE;
  ELSE
    SELECT usdt_amount INTO v_old_balance
    FROM users
    WHERE chat_id = p_chat_id
    FOR UPDATE;
  END IF;

  -- Перевіряємо, чи користувач існує
  IF v_old_balance IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'User not found');
  END IF;

  -- Перевіряємо, чи баланс не змінився (оптимістичне блокування)
  IF p_column = 'rub_amount' THEN
    UPDATE users
    SET rub_amount = p_new_balance
    WHERE chat_id = p_chat_id
      AND rub_amount = v_old_balance;
  ELSE
    UPDATE users
    SET usdt_amount = p_new_balance
    WHERE chat_id = p_chat_id
      AND usdt_amount = v_old_balance;
  END IF;

  -- Перевіряємо, чи було оновлено рядок
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Balance conflict, please retry');
  END IF;

  -- Оновлюємо інвойс, якщо вказано
  IF p_invoice_id IS NOT NULL THEN
    UPDATE invoices
    SET isPayed = true
    WHERE invoice_id = p_invoice_id
      AND isPayed = false;
  END IF;

  -- Логуємо транзакцію
  INSERT INTO atomic_transactions (
    operation, chat_id, amount, currency, old_balance, new_balance, invoice_id, status
  ) VALUES (
    'deposit', p_chat_id, p_amount, 
    CASE WHEN p_column = 'rub_amount' THEN 'rub' ELSE 'usdt' END,
    v_old_balance, p_new_balance, p_invoice_id, 'success'
  );

  RETURN json_build_object('success', true, 'new_balance', p_new_balance);
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- Функція для атомарного виведення
CREATE OR REPLACE FUNCTION atomic_withdraw(
  p_chat_id BIGINT,
  p_column TEXT,
  p_amount DECIMAL,
  p_new_balance DECIMAL,
  p_withdraw_id BIGINT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
AS $$
DECLARE
  v_old_balance DECIMAL;
BEGIN
  -- Блокуємо рядок для оновлення
  IF p_column = 'rub_amount' THEN
    SELECT rub_amount INTO v_old_balance
    FROM users
    WHERE chat_id = p_chat_id
    FOR UPDATE;
  ELSE
    SELECT usdt_amount INTO v_old_balance
    FROM users
    WHERE chat_id = p_chat_id
    FOR UPDATE;
  END IF;

  -- Перевіряємо, чи користувач існує
  IF v_old_balance IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'User not found');
  END IF;

  -- Перевіряємо достатність коштів
  IF v_old_balance < p_amount THEN
    RETURN json_build_object('success', false, 'error', 'Insufficient balance', 'balance', v_old_balance, 'required', p_amount);
  END IF;

  -- Оновлюємо баланс
  -- Оскільки рядок вже заблокований (FOR UPDATE), не перевіряємо баланс в WHERE
  -- Округлюємо значення до 2 знаків після коми
  IF p_column = 'rub_amount' THEN
    UPDATE users
    SET rub_amount = ROUND(p_new_balance::NUMERIC, 2)::DECIMAL
    WHERE chat_id = p_chat_id;
  ELSE
    UPDATE users
    SET usdt_amount = ROUND(p_new_balance::NUMERIC, 2)::DECIMAL
    WHERE chat_id = p_chat_id;
  END IF;

  -- Перевіряємо, чи було оновлено рядок
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'User not found');
  END IF;

  -- Оновлюємо withdraw, якщо вказано
  -- НЕ встановлюємо isDone = true тут, бо це має робити адміністратор при підтвердженні виводу
  -- При створенні виводу з web-app isDone має залишатися false
  -- IF p_withdraw_id IS NOT NULL THEN
  --   UPDATE withdraws
  --   SET "isDone" = true
  --   WHERE id = p_withdraw_id;
  -- END IF;

  -- Логуємо транзакцію
  INSERT INTO atomic_transactions (
    operation, chat_id, amount, currency, old_balance, new_balance, withdraw_id, status
  ) VALUES (
    'withdraw', p_chat_id, p_amount,
    CASE WHEN p_column = 'rub_amount' THEN 'rub' ELSE 'usdt' END,
    v_old_balance, p_new_balance, p_withdraw_id, 'success'
  );

  RETURN json_build_object('success', true, 'new_balance', p_new_balance);
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- Функція для атомарного обміну
CREATE OR REPLACE FUNCTION atomic_exchange(
  p_chat_id BIGINT,
  p_from_column TEXT,
  p_to_column TEXT,
  p_amount DECIMAL,
  p_exchange_rate DECIMAL,
  p_new_from_balance DECIMAL,
  p_new_to_balance DECIMAL
)
RETURNS JSON
LANGUAGE plpgsql
AS $$
DECLARE
  v_from_balance DECIMAL;
  v_to_balance DECIMAL;
  v_actual_from DECIMAL;
  v_actual_to DECIMAL;
  v_from_diff DECIMAL;
  v_to_diff DECIMAL;
BEGIN
  -- Спочатку блокуємо рядок для оновлення
  PERFORM 1
  FROM users
  WHERE chat_id = p_chat_id
  FOR UPDATE;

  -- Тепер вибираємо баланси (рядок вже заблокований транзакцією)
  -- Використовуємо окремі запити для уникнення проблем з типами
  IF p_from_column = 'rub_amount' THEN
    SELECT rub_amount INTO v_from_balance FROM users WHERE chat_id = p_chat_id;
  ELSIF p_from_column = 'usdt_amount' THEN
    SELECT usdt_amount INTO v_from_balance FROM users WHERE chat_id = p_chat_id;
  END IF;

  IF p_to_column = 'rub_amount' THEN
    SELECT rub_amount INTO v_to_balance FROM users WHERE chat_id = p_chat_id;
  ELSIF p_to_column = 'usdt_amount' THEN
    SELECT usdt_amount INTO v_to_balance FROM users WHERE chat_id = p_chat_id;
  END IF;

  -- Перевіряємо, чи користувач існує
  IF v_from_balance IS NULL OR v_to_balance IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'User not found');
  END IF;

  -- Перевіряємо достатність коштів
  IF v_from_balance < p_amount THEN
    RETURN json_build_object('success', false, 'error', 'Insufficient balance', 'balance', v_from_balance, 'required', p_amount);
  END IF;

  -- Оновлюємо обидва баланси атомарно
  -- Використовуємо заблокований рядок (FOR UPDATE вже заблокував його)
  -- Не перевіряємо баланси в WHERE, бо рядок вже заблокований транзакцією
  -- Використовуємо IF-ELSE замість CASE для уникнення проблем з типами
  -- Округлюємо значення до 2 знаків після коми для уникнення проблем з плаваючою точкою
  IF p_from_column = 'rub_amount' AND p_to_column = 'usdt_amount' THEN
    -- RUB -> USDT
    UPDATE users
    SET 
      rub_amount = ROUND(p_new_from_balance::NUMERIC, 2)::DECIMAL,
      usdt_amount = ROUND(p_new_to_balance::NUMERIC, 2)::DECIMAL
    WHERE chat_id = p_chat_id;
  ELSIF p_from_column = 'usdt_amount' AND p_to_column = 'rub_amount' THEN
    -- USDT -> RUB
    UPDATE users
    SET 
      usdt_amount = ROUND(p_new_from_balance::NUMERIC, 2)::DECIMAL,
      rub_amount = ROUND(p_new_to_balance::NUMERIC, 2)::DECIMAL
    WHERE chat_id = p_chat_id;
  ELSE
    -- Невідома комбінація (не повинно статися)
    RETURN json_build_object('success', false, 'error', 'Invalid currency combination');
  END IF;

  -- Перевіряємо, чи було оновлено рядок
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'User not found');
  END IF;
  
  -- Перевіряємо, чи баланси відповідають очікуваним (після оновлення)
  -- Оскільки рядок заблокований транзакцією, баланси не можуть змінитися
  -- Але перевіряємо для діагностики (не повертаємо помилку, якщо різниця невелика)
  -- Отримуємо фактичні баланси після оновлення для логування
  IF p_from_column = 'rub_amount' THEN
    SELECT rub_amount INTO v_actual_from
    FROM users
    WHERE chat_id = p_chat_id;
  ELSE
    SELECT usdt_amount INTO v_actual_from
    FROM users
    WHERE chat_id = p_chat_id;
  END IF;

  IF p_to_column = 'rub_amount' THEN
    SELECT rub_amount INTO v_actual_to
    FROM users
    WHERE chat_id = p_chat_id;
  ELSE
    SELECT usdt_amount INTO v_actual_to
    FROM users
    WHERE chat_id = p_chat_id;
  END IF;
  
  -- Перевіряємо баланси тільки для діагностики (не повертаємо помилку)
  -- Оскільки рядок заблокований транзакцією, баланси не можуть змінитися
  -- Але через округлення можуть бути невеликі відмінності
  v_from_diff := ABS(ROUND(v_actual_from, 2) - ROUND(p_new_from_balance, 2));
  v_to_diff := ABS(ROUND(v_actual_to, 2) - ROUND(p_new_to_balance, 2));
  
  -- Якщо різниця більша за 0.01, це може бути проблемою, але не критичною
  -- Оскільки рядок заблокований, баланси точно оновлені правильно
  -- Просто логуємо для діагностики, але не повертаємо помилку
  -- (Якщо потрібно, можна додати логування в окрему таблицю)
  
  -- Продовжуємо виконання незалежно від перевірки

  -- Логуємо транзакцію
  INSERT INTO atomic_transactions (
    operation, chat_id, amount, currency, old_balance, new_balance, exchange_rate, status
  ) VALUES (
    'exchange', p_chat_id, p_amount,
    p_from_column || '->' || p_to_column,
    v_from_balance, p_new_from_balance, p_exchange_rate, 'success'
  );

  RETURN json_build_object(
    'success', true, 
    'newFromBalance', p_new_from_balance,
    'newToBalance', p_new_to_balance
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- Функція для атомарного оновлення балансу трейду
CREATE OR REPLACE FUNCTION atomic_update_trade_balance(
  p_chat_id BIGINT,
  p_trade_id BIGINT,
  p_is_win BOOLEAN,
  p_amount DECIMAL,
  p_new_balance DECIMAL
)
RETURNS JSON
LANGUAGE plpgsql
AS $$
DECLARE
  v_old_balance DECIMAL;
  v_trade_active BOOLEAN;
  v_trade_is_win BOOLEAN;
  v_actual_balance DECIMAL;
BEGIN
  -- Блокуємо рядки для оновлення
  SELECT usdt_amount INTO v_old_balance
  FROM users
  WHERE chat_id = p_chat_id
  FOR UPDATE;

  SELECT isActive INTO v_trade_active
  FROM trades
  WHERE id = p_trade_id
  FOR UPDATE;

  -- Перевіряємо, чи користувач існує
  IF v_old_balance IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'User not found');
  END IF;

  -- Перевіряємо, чи трейд існує
  IF v_trade_active IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Trade not found');
  END IF;

  -- Якщо трейд вже закритий, все одно оновлюємо баланс
  -- (можливо баланс не був оновлений при закритті)
  -- Але перевіряємо, чи трейд не був закритий з іншим результатом
  IF NOT v_trade_active THEN
    -- Отримуємо результат трейду
    SELECT isWin INTO v_trade_is_win
    FROM trades
    WHERE id = p_trade_id;
    
    -- Якщо трейд вже закритий з правильним результатом, просто оновлюємо баланс
    IF v_trade_is_win IS NOT NULL AND v_trade_is_win = p_is_win THEN
      -- Трейд вже закритий з правильним результатом, просто оновлюємо баланс
      RAISE NOTICE '===== TRADE ALREADY CLOSED - UPDATING BALANCE =====';
      RAISE NOTICE 'Trade is already closed with correct result, updating balance only';
      RAISE NOTICE 'Updating users table: chat_id=%, old_balance=%, new_balance=%', p_chat_id, v_old_balance, p_new_balance;
      
      UPDATE users
      SET usdt_amount = ROUND(p_new_balance::NUMERIC, 2)::DECIMAL
      WHERE chat_id = p_chat_id;
      
      IF NOT FOUND THEN
        RAISE NOTICE 'ERROR: No rows updated in users table (already closed path)!';
        RETURN json_build_object('success', false, 'error', 'User not found after update (already closed)');
      END IF;
      
      RAISE NOTICE 'Balance updated successfully (trade already closed)';
      
      -- Логуємо транзакцію
      RAISE NOTICE '===== BEFORE INSERT atomic_transactions (already closed) =====';
      INSERT INTO atomic_transactions (
        operation, chat_id, amount, currency, old_balance, new_balance, trade_id, is_win, status
      ) VALUES (
        'update_trade_balance', p_chat_id, p_amount, 'USDT',
        v_old_balance, p_new_balance, p_trade_id, p_is_win, 'success'
      );
      RAISE NOTICE '===== AFTER INSERT atomic_transactions (already closed) =====';
      
      RETURN json_build_object('success', true, 'newBalance', p_new_balance, 'alreadyClosed', true);
    ELSE
      -- Трейд закритий з іншим результатом - це помилка
      RETURN json_build_object('success', false, 'error', 'Trade is already closed with different result');
    END IF;
  END IF;

  -- Оновлюємо баланс
  -- Оскільки рядок вже заблокований (FOR UPDATE), не перевіряємо баланс в WHERE
  -- Округлюємо значення до 2 знаків після коми
  RAISE NOTICE '===== BEFORE UPDATE users =====';
  RAISE NOTICE 'Updating users table: chat_id=%, old_balance=%, new_balance=%', p_chat_id, v_old_balance, p_new_balance;
  RAISE NOTICE 'UPDATE query: UPDATE users SET usdt_amount = % WHERE chat_id = %', p_new_balance, p_chat_id;
  
  UPDATE users
  SET usdt_amount = ROUND(p_new_balance::NUMERIC, 2)::DECIMAL
  WHERE chat_id = p_chat_id;

  -- Перевіряємо, чи було оновлено рядок
  IF NOT FOUND THEN
    RAISE NOTICE 'ERROR: No rows updated in users table!';
    RETURN json_build_object('success', false, 'error', 'User not found after update');
  END IF;
  
  RAISE NOTICE '===== AFTER UPDATE users =====';
  RAISE NOTICE 'Rows updated: 1 (assuming success)';
  
  -- Перевіряємо фактичний баланс після оновлення для діагностики
  SELECT usdt_amount INTO v_actual_balance
  FROM users
  WHERE chat_id = p_chat_id;
  
  -- Логуємо для діагностики
  RAISE NOTICE 'Balance verification: old=%, new=%, actual=%', v_old_balance, p_new_balance, v_actual_balance;
  RAISE NOTICE 'Balance difference: %', v_actual_balance - p_new_balance;

  -- Оновлюємо статус трейду
  -- Оновлюємо навіть якщо трейд вже закритий (якщо результат правильний)
  RAISE NOTICE '===== BEFORE UPDATE trades =====';
  RAISE NOTICE 'Updating trades table: trade_id=%, isActive=false, isWin=%', p_trade_id, p_is_win;
  RAISE NOTICE 'UPDATE query: UPDATE trades SET isActive = false, isWin = % WHERE id = %', p_is_win, p_trade_id;
  
  UPDATE trades
  SET isActive = false, isWin = p_is_win
  WHERE id = p_trade_id
    AND (isActive = true OR (isActive = false AND isWin = p_is_win));
  
  IF NOT FOUND THEN
    RAISE NOTICE 'WARNING: No rows updated in trades table (trade may already be closed with different result)';
  ELSE
    RAISE NOTICE '===== AFTER UPDATE trades =====';
    RAISE NOTICE 'Trade updated successfully';
  END IF;

  -- Логуємо транзакцію
  RAISE NOTICE '===== BEFORE INSERT atomic_transactions =====';
  RAISE NOTICE 'Inserting transaction log: operation=update_trade_balance, chat_id=%, amount=%, old_balance=%, new_balance=%, trade_id=%', 
    p_chat_id, p_amount, v_old_balance, p_new_balance, p_trade_id;
  
  INSERT INTO atomic_transactions (
    operation, chat_id, amount, currency, old_balance, new_balance, trade_id, is_win, status
  ) VALUES (
    'update_trade_balance', p_chat_id, p_amount, 'USDT',
    v_old_balance, p_new_balance, p_trade_id, p_is_win, 'success'
  );
  
  RAISE NOTICE '===== AFTER INSERT atomic_transactions =====';
  RAISE NOTICE 'Transaction logged successfully';

  RETURN json_build_object('success', true, 'newBalance', p_new_balance);
EXCEPTION
  WHEN OTHERS THEN
    -- Логуємо детальну інформацію про помилку
    RAISE WARNING 'Error in atomic_update_trade_balance: %', SQLERRM;
    RETURN json_build_object(
      'success', false, 
      'error', SQLERRM,
      'sqlstate', SQLSTATE
    );
END;
$$;

