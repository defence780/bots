-- Создание таблицы для сообщений new-employee
CREATE TABLE IF NOT EXISTS "new-employee-messages" (
  id BIGSERIAL PRIMARY KEY,
  chat_id BIGINT NOT NULL,
  "from" VARCHAR(50) NOT NULL,
  "to" VARCHAR(50) NOT NULL,
  message TEXT NOT NULL,
  step VARCHAR(20),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Создание индексов для быстрого поиска
CREATE INDEX IF NOT EXISTS idx_new_employee_messages_chat_id ON "new-employee-messages"(chat_id);
CREATE INDEX IF NOT EXISTS idx_new_employee_messages_created_at ON "new-employee-messages"(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_new_employee_messages_step ON "new-employee-messages"(step) WHERE step IS NOT NULL;

-- Обновление таблицы new-employee для хранения только заявок
-- Добавляем поле isDone если его нет
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'new-employee' AND column_name = 'isDone') THEN
    ALTER TABLE "new-employee" ADD COLUMN "isDone" BOOLEAN DEFAULT false;
  END IF;
END $$;

-- Удаляем поля, которые теперь будут в new-employee-messages (если они есть)
-- Но сначала переносим данные из new-employee в new-employee-messages
INSERT INTO "new-employee-messages" (chat_id, "from", "to", message, step, created_at)
SELECT 
  chat_id,
  COALESCE("from", 'bot'),
  COALESCE("to", CAST(chat_id AS VARCHAR)),
  COALESCE(message, ''),
  step,
  COALESCE(created_at, NOW())
FROM "new-employee"
WHERE message IS NOT NULL
ON CONFLICT DO NOTHING;

-- Удаляем дубликаты chat_id в таблице new-employee
-- Оставляем только один запись на chat_id (самый новый или с лучшими данными)
DO $$
DECLARE
  temp_table_name TEXT := 'temp_new_employee_unique';
BEGIN
  -- Создаем временную таблицу с уникальными chat_id
  -- Оставляем запись с наибольшим id (самый новый) или с username/first_name если есть
  EXECUTE format('
    CREATE TEMP TABLE %I AS
    SELECT DISTINCT ON (chat_id) 
      id,
      chat_id,
      username,
      first_name,
      "isDone",
      created_at
    FROM "new-employee"
    ORDER BY chat_id, 
             CASE WHEN username IS NOT NULL OR first_name IS NOT NULL THEN 0 ELSE 1 END,
             id DESC
  ', temp_table_name);
  
  -- Удаляем все записи из оригинальной таблицы
  DELETE FROM "new-employee";
  
  -- Вставляем обратно только уникальные записи
  EXECUTE format('
    INSERT INTO "new-employee" (id, chat_id, username, first_name, "isDone", created_at)
    SELECT id, chat_id, username, first_name, "isDone", created_at
    FROM %I
  ', temp_table_name);
  
  -- Удаляем временную таблицу
  EXECUTE format('DROP TABLE IF EXISTS %I', temp_table_name);
END $$;

-- Создаем уникальный индекс на chat_id, чтобы предотвратить дубликаты в будущем
CREATE UNIQUE INDEX IF NOT EXISTS idx_new_employee_chat_id_unique ON "new-employee"(chat_id);

-- Комментарии для документации
COMMENT ON TABLE "new-employee-messages" IS 'Все сообщения в чатах новых сотрудников';
COMMENT ON TABLE "new-employee" IS 'Заявки новых сотрудников (создаются при нажатии /start)';
COMMENT ON COLUMN "new-employee"."isDone" IS 'Статус обработки заявки: true - обработана, false - не обработана';

