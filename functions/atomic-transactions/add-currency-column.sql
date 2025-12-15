-- Міграція для додавання колонки currency в таблицю atomic_transactions
-- Якщо колонка вже існує, міграція не зробить нічого

-- Перевіряємо, чи існує колонка currency
DO $$
BEGIN
  -- Якщо колонки немає, додаємо її
  IF NOT EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_name = 'atomic_transactions' 
    AND column_name = 'currency'
  ) THEN
    -- Додаємо колонку currency
    ALTER TABLE atomic_transactions 
    ADD COLUMN currency VARCHAR(10) NOT NULL DEFAULT 'usdt';
    
    -- Оновлюємо існуючі записи на основі операції
    -- Для deposit/withdraw використовуємо 'usdt' як дефолт
    -- Для exchange використовуємо формат 'from->to'
    UPDATE atomic_transactions 
    SET currency = CASE 
      WHEN operation = 'exchange' THEN 'usdt->rub'
      WHEN operation IN ('deposit', 'withdraw', 'update_trade_balance', 'update_invoice_balance') THEN 'usdt'
      ELSE 'usdt'
    END
    WHERE currency IS NULL OR currency = '';
    
    -- Після оновлення всіх записів, можна зняти DEFAULT (якщо потрібно)
    -- ALTER TABLE atomic_transactions ALTER COLUMN currency DROP DEFAULT;
  END IF;
END $$;

-- Коментар для документації
COMMENT ON COLUMN atomic_transactions.currency IS 'Валюта транзакції: rub, usdt, або формат from->to для exchange';

