-- Виправлення генерації id для таблиці new-employee-messages
-- Перетворюємо identity column на звичайний BIGSERIAL з DEFAULT nextval()

DO $$
DECLARE
  sequence_name TEXT;
  max_id BIGINT;
  is_identity BOOLEAN;
  identity_type TEXT;
  default_value TEXT;
BEGIN
  -- Перевіряємо, чи існує таблиця
  IF EXISTS (SELECT 1 FROM information_schema.tables 
             WHERE table_schema = 'public' 
             AND table_name = 'new-employee-messages') THEN
    
    -- Отримуємо максимальний id з таблиці (якщо є дані)
    SELECT COALESCE(MAX(id), 0) INTO max_id 
    FROM "new-employee-messages";
    
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
      RAISE NOTICE 'Колонка id є identity column (тип: %), перетворюємо на BIGSERIAL з DEFAULT', COALESCE(identity_type, 'UNKNOWN');
      
      -- Знаходимо назву послідовності для identity column
      SELECT pg_get_serial_sequence('"new-employee-messages"', 'id') INTO sequence_name;
      
      -- Якщо послідовність не знайдена, створюємо стандартну назву
      IF sequence_name IS NULL THEN
        sequence_name := 'new-employee-messages_id_seq';
      ELSE
        -- Витягуємо тільки назву послідовності (без схеми)
        sequence_name := regexp_replace(sequence_name, '^[^.]*\.', '');
      END IF;
      
      RAISE NOTICE 'Знайдена послідовність: %', sequence_name;
      
      -- Перетворюємо identity column на звичайну колонку з DEFAULT
      -- Спочатку видаляємо identity
      ALTER TABLE "new-employee-messages" 
        ALTER COLUMN id DROP IDENTITY IF EXISTS;
      
      -- Встановлюємо DEFAULT через nextval()
      EXECUTE format('ALTER TABLE "new-employee-messages" 
                      ALTER COLUMN id SET DEFAULT nextval(%L)', sequence_name);
      
      -- Перевіряємо, чи послідовність існує, якщо ні - створюємо
      IF NOT EXISTS (SELECT 1 FROM pg_sequences 
                     WHERE schemaname = 'public' 
                     AND sequencename = sequence_name) THEN
        EXECUTE format('CREATE SEQUENCE IF NOT EXISTS %I', sequence_name);
        EXECUTE format('ALTER SEQUENCE %I OWNED BY "new-employee-messages".id', sequence_name);
      END IF;
      
      -- Встановлюємо правильне значення послідовності
      EXECUTE format('SELECT setval(%L, %s, true)', sequence_name, GREATEST(max_id, 1));
      
      RAISE NOTICE 'Колонка id перетворена на BIGSERIAL з DEFAULT nextval(%L)', sequence_name;
      
    ELSE
      RAISE NOTICE 'Колонка id не є identity column, перевіряємо DEFAULT';
      
      -- Знаходимо назву послідовності з DEFAULT
      SELECT column_default INTO sequence_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'new-employee-messages'
        AND column_name = 'id';
      
      -- Витягуємо назву послідовності з DEFAULT
      IF sequence_name IS NOT NULL AND sequence_name LIKE 'nextval%' THEN
        sequence_name := regexp_replace(sequence_name, '.*nextval\([''"]?([^''"]+)[''"]?\).*', '\1');
        -- Видаляємо схему, якщо є
        sequence_name := regexp_replace(sequence_name, '^[^.]*\.', '');
      ELSE
        -- Спробуємо знайти послідовність
        SELECT sequencename INTO sequence_name
        FROM pg_sequences
        WHERE schemaname = 'public'
          AND sequencename LIKE '%new-employee-messages%id%seq%'
        LIMIT 1;
        
        IF sequence_name IS NULL THEN
          sequence_name := 'new-employee-messages_id_seq';
        END IF;
      END IF;
      
      -- Перевіряємо, чи послідовність існує
      IF NOT EXISTS (SELECT 1 FROM pg_sequences 
                     WHERE schemaname = 'public' 
                     AND sequencename = sequence_name) THEN
        EXECUTE format('CREATE SEQUENCE IF NOT EXISTS %I', sequence_name);
        EXECUTE format('ALTER SEQUENCE %I OWNED BY "new-employee-messages".id', sequence_name);
      END IF;
      
      -- Встановлюємо правильне значення послідовності
      EXECUTE format('SELECT setval(%L, %s, true)', sequence_name, GREATEST(max_id, 1));
      
      -- Встановлюємо DEFAULT, якщо його немає
      SELECT column_default INTO default_value
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'new-employee-messages'
        AND column_name = 'id';
      
      IF default_value IS NULL OR default_value NOT LIKE '%nextval%' THEN
        EXECUTE format('ALTER TABLE "new-employee-messages" 
                        ALTER COLUMN id SET DEFAULT nextval(%L)', sequence_name);
        RAISE NOTICE 'DEFAULT для колонки id встановлено';
      ELSE
        RAISE NOTICE 'DEFAULT для колонки id вже встановлено правильно';
      END IF;
    END IF;
    
  ELSE
    RAISE NOTICE 'Таблиця new-employee-messages не існує';
  END IF;
END $$;

-- Перевірка: переконаємося, що DEFAULT встановлено правильно
DO $$
DECLARE
  default_value TEXT;
BEGIN
  SELECT column_default INTO default_value
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'new-employee-messages'
    AND column_name = 'id';
  
  IF default_value IS NULL THEN
    RAISE WARNING 'DEFAULT для колонки id не встановлено!';
  ELSE
    RAISE NOTICE 'DEFAULT для колонки id: %', default_value;
  END IF;
END $$;

-- Коментарі для документації
COMMENT ON TABLE "new-employee-messages" IS 'Всі повідомлення в чатах нових співробітників. ID генерується автоматично через DEFAULT nextval().';
