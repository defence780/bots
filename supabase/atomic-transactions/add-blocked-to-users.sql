-- Міграція для додавання поля blocked до таблиці users
-- Додаємо поле для блокування доступу користувачів web-app

ALTER TABLE IF EXISTS "users"
ADD COLUMN IF NOT EXISTS blocked BOOLEAN NOT NULL DEFAULT FALSE;

-- Індекс для швидкого пошуку заблокованих користувачів
CREATE INDEX IF NOT EXISTS idx_users_blocked ON "users"(blocked);

-- Коментарі для документації
COMMENT ON COLUMN "users".blocked IS 'Статус блокування користувача: true - заблокований (не може відкрити посилання на бота), false - активний';
