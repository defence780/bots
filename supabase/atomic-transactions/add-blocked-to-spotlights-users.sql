-- Міграція для додавання поля blocked до таблиці spotlights_users
-- Додаємо поле для блокування доступу користувачів

ALTER TABLE IF EXISTS "spotlights_users"
ADD COLUMN IF NOT EXISTS blocked BOOLEAN NOT NULL DEFAULT FALSE;

-- Індекс для швидкого пошуку заблокованих користувачів
CREATE INDEX IF NOT EXISTS idx_spotlights_users_blocked ON "spotlights_users"(blocked);

-- Коментарі для документації
COMMENT ON COLUMN "spotlights_users".blocked IS 'Статус блокування користувача: true - заблокований, false - активний';
