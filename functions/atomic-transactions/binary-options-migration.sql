-- Создание таблицы для бинарных опционов
CREATE TABLE IF NOT EXISTS binary_options (
  id BIGSERIAL PRIMARY KEY,
  chat_id BIGINT NOT NULL,
  token VARCHAR(20) NOT NULL,
  direction VARCHAR(10) NOT NULL CHECK (direction IN ('up', 'down')),
  amount DECIMAL(18, 2) NOT NULL CHECK (amount > 0),
  entry_price DECIMAL(18, 8) NOT NULL,
  exit_price DECIMAL(18, 8),
  expiration_time INTEGER NOT NULL CHECK (expiration_time > 0),
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'won', 'lost', 'expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  payout DECIMAL(18, 2)
);

-- Индексы для быстрого поиска
CREATE INDEX IF NOT EXISTS idx_binary_options_chat_id ON binary_options(chat_id);
CREATE INDEX IF NOT EXISTS idx_binary_options_status ON binary_options(status);
CREATE INDEX IF NOT EXISTS idx_binary_options_created_at ON binary_options(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_binary_options_active ON binary_options(chat_id, status) WHERE status = 'active';

-- Комментарии для документации
COMMENT ON TABLE binary_options IS 'Бинарные опционы пользователей';
COMMENT ON COLUMN binary_options.direction IS 'Направление: up (вверх) или down (вниз)';
COMMENT ON COLUMN binary_options.expiration_time IS 'Время экспирации в секундах';
COMMENT ON COLUMN binary_options.status IS 'Статус: active (активен), won (выигрыш), lost (проигрыш), expired (истек)';
COMMENT ON COLUMN binary_options.payout IS 'Выплата при выигрыше (null если проигрыш)';

