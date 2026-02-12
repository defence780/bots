-- Виправлення послідовності для таблиці new-employee-messages
-- Ця міграція виправляє проблему з автоматичною генерацією id

-- Спочатку знаходимо правильну назву послідовності
DO $$
DECLARE
  sequence_name TEXT;
  max_id BIGINT;
  default_value TEXT;
  is_identity BOOLEAN;
  identity_type TEXT;
BEGIN
  -- Перевіряємо, чи існує таблиця
  IF EXISTS (SELECT 1 FROM information_schema.tables 
             WHERE table_schema = 'public' 
             AND table_name = 'new-employee-messages') THEN
    
    -- Отримуємо максимальний id з таблиці (якщо є дані)
    SELECT COALESCE(MAX(id), 0) INTO max_id 
    FROM "new-employee-messages";
    
    -- Знаходимо назву послідовності з DEFAULT значення колонки id
    SELECT column_default INTO default_value
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'new-employee-messages'
      AND column_name = 'id';
    
    -- Якщо DEFAULT вже встановлено, витягуємо назву послідовності
    IF default_value IS NOT NULL AND default_value LIKE 'nextval%' THEN
      -- Витягуємо назву послідовності з DEFAULT
      sequence_name := regexp_replace(default_value, '.*nextval\([''"]?([^''"]+)[''"]?\).*', '\1');
    ELSE
      -- Спробуємо знайти послідовність за стандартною назвою
      SELECT sequencename INTO sequence_name
      FROM pg_sequences
      WHERE schemaname = 'public'
        AND sequencename LIKE '%new-employee-messages%id%seq%'
      LIMIT 1;
      
      -- Якщо не знайдено, створюємо стандартну назву
      IF sequence_name IS NULL THEN
        sequence_name := 'new-employee-messages_id_seq';
      END IF;
    END IF;
    
    RAISE NOTICE 'Знайдена/створена назва послідовності: %', sequence_name;
    
    -- Перевіряємо, чи існує послідовність
    IF EXISTS (SELECT 1 FROM pg_sequences 
               WHERE schemaname = 'public' 
               AND sequencename = sequence_name) THEN
      -- Якщо послідовність існує, встановлюємо правильне значення
      EXECUTE format('SELECT setval(%L, %s, true)', sequence_name, GREATEST(max_id, 1));
      RAISE NOTICE 'Послідовність % встановлена на %', sequence_name, GREATEST(max_id, 1);
    ELSE
      -- Якщо послідовність не існує, створюємо її
      EXECUTE format('CREATE SEQUENCE IF NOT EXISTS %I', sequence_name);
      EXECUTE format('ALTER SEQUENCE %I OWNED BY "new-employee-messages".id', sequence_name);
      EXECUTE format('SELECT setval(%L, %s, true)', sequence_name, GREATEST(max_id, 1));
      RAISE NOTICE 'Послідовність % створена та встановлена на %', sequence_name, GREATEST(max_id, 1);
    END IF;
    
    -- Перевіряємо, чи колонка id є identity column
    SELECT 
      CASE WHEN c.is_identity = 'YES' THEN true ELSE false END,
      c.identity_generation
    INTO is_identity, identity_type
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'new-employee-messages'
      AND c.column_name = 'id';
    
    IF is_identity THEN
      RAISE NOTICE 'Колонка id є identity column (тип: %), не потрібно встановлювати DEFAULT', COALESCE(identity_type, 'UNKNOWN');
    ELSE
      -- Перевіряємо, чи колонка id має правильний DEFAULT
      SELECT column_default INTO default_value
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'new-employee-messages'
        AND column_name = 'id';
      
      IF default_value IS NULL OR default_value NOT LIKE '%' || sequence_name || '%' THEN
        -- Встановлюємо DEFAULT для колонки id
        EXECUTE format('ALTER TABLE "new-employee-messages" 
                        ALTER COLUMN id SET DEFAULT nextval(%L)', sequence_name);
        RAISE NOTICE 'DEFAULT для колонки id встановлено: nextval(%L)', sequence_name;
      ELSE
        RAISE NOTICE 'DEFAULT для колонки id вже встановлено правильно';
      END IF;
    END IF;
    
  ELSE
    RAISE NOTICE 'Таблиця new-employee-messages не існує, створюємо її з правильною послідовністю';
    
    -- Створюємо таблицю з правильною послідовністю
    CREATE TABLE "new-employee-messages" (
      id BIGSERIAL PRIMARY KEY,
      chat_id BIGINT NOT NULL,
      "from" VARCHAR(50) NOT NULL,
      "to" VARCHAR(50) NOT NULL,
      message TEXT NOT NULL,
      step VARCHAR(20),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    
    -- Створюємо індекси
    CREATE INDEX IF NOT EXISTS idx_new_employee_messages_chat_id ON "new-employee-messages"(chat_id);
    CREATE INDEX IF NOT EXISTS idx_new_employee_messages_created_at ON "new-employee-messages"(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_new_employee_messages_step ON "new-employee-messages"(step) WHERE step IS NOT NULL;
    
    RAISE NOTICE 'Таблиця new-employee-messages створена';
  END IF;
END $$;

-- Додаткова перевірка: якщо таблиця існує, але колонка id не має правильного типу
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables 
             WHERE table_schema = 'public' 
             AND table_name = 'new-employee-messages') THEN
    
    -- Перевіряємо тип колонки id
    IF EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_schema = 'public' 
      AND table_name = 'new-employee-messages' 
      AND column_name = 'id'
      AND data_type != 'bigint'
    ) THEN
      -- Якщо тип неправильний, виправляємо його
      ALTER TABLE "new-employee-messages" 
      ALTER COLUMN id TYPE BIGINT;
      
      RAISE NOTICE 'Тип колонки id виправлено на BIGINT';
    END IF;
    
  END IF;
END $$;

-- Коментарі для документації
COMMENT ON TABLE "new-employee-messages" IS 'Всі повідомлення в чатах нових співробітників. ID генерується автоматично через послідовність.';
