-- Міграція для встановлення значення за замовчуванням для isDone в таблиці withdraws
-- Якщо колонка вже існує, оновлюємо значення за замовчуванням
-- Якщо колонки немає, додаємо її зі значенням за замовчуванням

-- Перевіряємо, чи існує колонка isDone
DO $$
BEGIN
  -- Якщо колонка існує, оновлюємо значення за замовчуванням
  IF EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_name = 'withdraws' 
    AND column_name = 'isDone'
  ) THEN
    -- Оновлюємо значення за замовчуванням
    ALTER TABLE withdraws 
    ALTER COLUMN "isDone" SET DEFAULT false;
    
    -- Оновлюємо всі існуючі записи, де isDone = NULL, на false
    UPDATE withdraws 
    SET "isDone" = false 
    WHERE "isDone" IS NULL;
  ELSE
    -- Якщо колонки немає, додаємо її зі значенням за замовчуванням
    ALTER TABLE withdraws 
    ADD COLUMN "isDone" BOOLEAN NOT NULL DEFAULT false;
  END IF;
END $$;

-- Коментар для документації
COMMENT ON COLUMN withdraws."isDone" IS 'Чи виконана заявка на вивід (по дефолту false)';

