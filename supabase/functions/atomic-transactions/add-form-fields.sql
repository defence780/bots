-- Міграція для додавання полів форми до таблиці analytics-users
-- Додаємо поля для зберігання стану багатокрокової форми

ALTER TABLE IF EXISTS "analytics-users"
ADD COLUMN IF NOT EXISTS form_step VARCHAR(50),
ADD COLUMN IF NOT EXISTS form_data TEXT;

-- Коментарі для документації
COMMENT ON COLUMN "analytics-users".form_step IS 'Поточний крок форми (report_date, report_description, lead_name, lead_contact, тощо)';
COMMENT ON COLUMN "analytics-users".form_data IS 'JSON дані форми, що заповнюються покроково';
