-- Додавання колонки для зберігання стану очікування дії користувача
-- Це дозволяє зберігати стан між викликами Edge Function

ALTER TABLE IF EXISTS "analytics-users" 
ADD COLUMN IF NOT EXISTS awaiting_action VARCHAR(50);

-- Коментар для документації
COMMENT ON COLUMN "analytics-users".awaiting_action IS 'Статус очікування: null, report, lead, closer_report';
