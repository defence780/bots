-- Міграція для створення таблиці лідов від воркерів
-- Таблиця для зберігання інформації про потенційних клієнтів, які воркери передають клоузерам

CREATE TABLE IF NOT EXISTS worker_leads (
  id BIGSERIAL PRIMARY KEY,
  worker_chat_id BIGINT NOT NULL,
  closer_chat_id BIGINT NOT NULL,
  lead_name VARCHAR(255),
  lead_contact VARCHAR(255), -- Телефон, email, telegram username тощо
  lead_info TEXT, -- Додаткова інформація про ліда
  lead_status VARCHAR(20) NOT NULL DEFAULT 'new' CHECK (lead_status IN ('new', 'contacted', 'converted', 'lost')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT -- Нотатки клоузера про ліда
);

-- Індекси для швидкого пошуку
CREATE INDEX IF NOT EXISTS idx_worker_leads_worker ON worker_leads(worker_chat_id);
CREATE INDEX IF NOT EXISTS idx_worker_leads_closer ON worker_leads(closer_chat_id);
CREATE INDEX IF NOT EXISTS idx_worker_leads_status ON worker_leads(lead_status);
CREATE INDEX IF NOT EXISTS idx_worker_leads_created_at ON worker_leads(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_worker_leads_closer_new ON worker_leads(closer_chat_id, lead_status) WHERE lead_status = 'new';

-- Тригер для автоматичного оновлення updated_at
CREATE OR REPLACE FUNCTION update_worker_leads_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_worker_leads_updated_at ON worker_leads;
CREATE TRIGGER trigger_update_worker_leads_updated_at
BEFORE UPDATE ON worker_leads
FOR EACH ROW
EXECUTE FUNCTION update_worker_leads_updated_at();

-- Коментарі для документації
COMMENT ON TABLE worker_leads IS 'Ліди від воркерів, які передаються клоузерам';
COMMENT ON COLUMN worker_leads.worker_chat_id IS 'Chat ID воркера, який передав ліда';
COMMENT ON COLUMN worker_leads.closer_chat_id IS 'Chat ID клоузера, якому передано ліда';
COMMENT ON COLUMN worker_leads.lead_name IS 'Ім''я ліда';
COMMENT ON COLUMN worker_leads.lead_contact IS 'Контакт ліда (телефон, email, telegram)';
COMMENT ON COLUMN worker_leads.lead_info IS 'Додаткова інформація про ліда';
COMMENT ON COLUMN worker_leads.lead_status IS 'Статус ліда: new (новий), contacted (зв''язався), converted (конвертувався), lost (втрачений)';
