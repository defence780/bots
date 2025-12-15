-- Створення таблиці для логування атомарних транзакцій
CREATE TABLE IF NOT EXISTS atomic_transactions (
  id BIGSERIAL PRIMARY KEY,
  operation VARCHAR(50) NOT NULL,
  chat_id BIGINT NOT NULL,
  amount DECIMAL(18, 2) NOT NULL,
  currency VARCHAR(10) NOT NULL,
  old_balance DECIMAL(18, 2) NOT NULL,
  new_balance DECIMAL(18, 2) NOT NULL,
  invoice_id BIGINT,
  withdraw_id BIGINT,
  trade_id BIGINT,
  is_win BOOLEAN,
  exchange_rate DECIMAL(18, 8),
  status VARCHAR(20) NOT NULL DEFAULT 'success',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Індекси для швидкого пошуку
CREATE INDEX IF NOT EXISTS idx_atomic_transactions_chat_id ON atomic_transactions(chat_id);
CREATE INDEX IF NOT EXISTS idx_atomic_transactions_operation ON atomic_transactions(operation);
CREATE INDEX IF NOT EXISTS idx_atomic_transactions_created_at ON atomic_transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_atomic_transactions_invoice_id ON atomic_transactions(invoice_id) WHERE invoice_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_atomic_transactions_withdraw_id ON atomic_transactions(withdraw_id) WHERE withdraw_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_atomic_transactions_trade_id ON atomic_transactions(trade_id) WHERE trade_id IS NOT NULL;

-- Коментарі для документації
COMMENT ON TABLE atomic_transactions IS 'Лог всіх атомарних транзакцій для аудиту та моніторингу';
COMMENT ON COLUMN atomic_transactions.operation IS 'Тип операції: deposit, withdraw, exchange, update_trade_balance, update_invoice_balance';
COMMENT ON COLUMN atomic_transactions.status IS 'Статус транзакції: success, error, pending';

