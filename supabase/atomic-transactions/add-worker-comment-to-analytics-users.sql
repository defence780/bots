-- Додаємо колонку worker_comment до таблиці "analytics-users"
-- для зберігання коментаря по воркеру / клоузеру в контексті аналітики

ALTER TABLE "analytics-users"
ADD COLUMN IF NOT EXISTS worker_comment TEXT;

COMMENT ON COLUMN "analytics-users".worker_comment IS 'Коментар по воркеру/клоузеру для внутрішньої аналітики';

