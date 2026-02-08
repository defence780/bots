-- Міграція для додавання полів поточного стану бінарних опціонів
-- Спочатку створюємо таблицю, якщо вона не існує

-- Створення таблиці для бінарних опціонів (якщо не існує)
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

-- Додаємо поле для поточної ціни
ALTER TABLE binary_options 
ADD COLUMN IF NOT EXISTS current_price DECIMAL(18, 8);

-- Додаємо поле для часу останньої перевірки
ALTER TABLE binary_options 
ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ;

-- Додаємо поле для збереження історії цін (JSON)
ALTER TABLE binary_options 
ADD COLUMN IF NOT EXISTS price_history JSONB DEFAULT '[]'::jsonb;

-- Додаємо поле для збереження поточного статусу перевірки
ALTER TABLE binary_options 
ADD COLUMN IF NOT EXISTS check_status VARCHAR(20) DEFAULT 'pending' CHECK (check_status IN ('pending', 'checking', 'checked'));

-- Оновлюємо існуючі записи: встановлюємо current_price = entry_price для активних опціонів
UPDATE binary_options 
SET current_price = entry_price,
    last_checked_at = created_at,
    check_status = 'pending'
WHERE status = 'active' AND current_price IS NULL;

-- Створюємо індекс для швидкого пошуку опціонів, які потребують перевірки
CREATE INDEX IF NOT EXISTS idx_binary_options_check_status 
ON binary_options(chat_id, status, check_status) 
WHERE status = 'active' AND check_status = 'pending';

-- Створюємо індекс для пошуку за current_price
CREATE INDEX IF NOT EXISTS idx_binary_options_current_price 
ON binary_options(current_price) 
WHERE status = 'active';

-- Індекси для швидкого пошуку (якщо не існують)
CREATE INDEX IF NOT EXISTS idx_binary_options_chat_id ON binary_options(chat_id);
CREATE INDEX IF NOT EXISTS idx_binary_options_status ON binary_options(status);
CREATE INDEX IF NOT EXISTS idx_binary_options_created_at ON binary_options(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_binary_options_active ON binary_options(chat_id, status) WHERE status = 'active';

-- Коментарі для документації
COMMENT ON TABLE binary_options IS 'Бинарные опционы пользователей';
COMMENT ON COLUMN binary_options.direction IS 'Направление: up (вверх) или down (вниз)';
COMMENT ON COLUMN binary_options.expiration_time IS 'Время экспирации в секундах';
COMMENT ON COLUMN binary_options.status IS 'Статус: active (активен), won (выигрыш), lost (проигрыш), expired (истек)';
COMMENT ON COLUMN binary_options.payout IS 'Выплата при выигрыше (null если проигрыш)';
COMMENT ON COLUMN binary_options.current_price IS 'Поточна ціна токена в момент останньої перевірки';
COMMENT ON COLUMN binary_options.last_checked_at IS 'Час останньої перевірки стану опціону';
COMMENT ON COLUMN binary_options.price_history IS 'Історія змін ціни у форматі JSON масиву';
COMMENT ON COLUMN binary_options.check_status IS 'Статус перевірки: pending (очікує), checking (перевіряється), checked (перевірено)';
