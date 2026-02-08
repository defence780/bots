-- Додавання нових статусів для лідов: rejected (відмовлені) та closed (закриті)

-- Оновлюємо CHECK constraint для додавання нових статусів
ALTER TABLE IF EXISTS worker_leads
DROP CONSTRAINT IF EXISTS worker_leads_lead_status_check;

ALTER TABLE IF EXISTS worker_leads
ADD CONSTRAINT worker_leads_lead_status_check 
CHECK (lead_status IN ('new', 'contacted', 'converted', 'lost', 'rejected', 'closed'));

-- Коментар для документації
COMMENT ON COLUMN worker_leads.lead_status IS 'Статус ліда: new (новий), contacted (в обробці), converted (конвертований), lost (втрачений), rejected (відмовлений), closed (закритий)';
