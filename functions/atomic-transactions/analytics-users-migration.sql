-- Міграція для створення таблиці analytics-users
-- Таблиця для зберігання користувачів аналітики (клоузерів та воркерів)

CREATE TABLE IF NOT EXISTS "analytics-users" (
  id BIGSERIAL PRIMARY KEY,
  chat_id BIGINT NOT NULL UNIQUE,
  username VARCHAR(255),
  first_name VARCHAR(255),
  ref_id BIGINT, -- Chat ID клоузера (для воркерів)
  role VARCHAR(20) NOT NULL DEFAULT 'worker' CHECK (role IN ('closer', 'worker')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Індекси для швидкого пошуку
CREATE INDEX IF NOT EXISTS idx_analytics_users_chat_id ON "analytics-users"(chat_id);
CREATE INDEX IF NOT EXISTS idx_analytics_users_ref_id ON "analytics-users"(ref_id);
CREATE INDEX IF NOT EXISTS idx_analytics_users_role ON "analytics-users"(role);
CREATE INDEX IF NOT EXISTS idx_analytics_users_closer_workers ON "analytics-users"(ref_id, role) WHERE role = 'worker';

-- Тригер для автоматичного оновлення updated_at
CREATE OR REPLACE FUNCTION update_analytics_users_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_analytics_users_updated_at ON "analytics-users";
CREATE TRIGGER trigger_update_analytics_users_updated_at
BEFORE UPDATE ON "analytics-users"
FOR EACH ROW
EXECUTE FUNCTION update_analytics_users_updated_at();

-- Коментарі для документації
COMMENT ON TABLE "analytics-users" IS 'Користувачі системи аналітики (клоузери та воркери)';
COMMENT ON COLUMN "analytics-users".chat_id IS 'Chat ID користувача в Telegram';
COMMENT ON COLUMN "analytics-users".ref_id IS 'Chat ID клоузера (для воркерів - посилання на клоузера)';
COMMENT ON COLUMN "analytics-users".role IS 'Роль: closer (клоузер) або worker (воркер)';
