-- Міграція для створення таблиці звітів клоузерів
-- Таблиця для зберігання звітів, які клоузери надсилають (з фото та текстом)

CREATE TABLE IF NOT EXISTS closer_reports (
  id BIGSERIAL PRIMARY KEY,
  closer_chat_id BIGINT NOT NULL,
  message_text TEXT,
  message_type VARCHAR(50) DEFAULT 'text', -- text, photo, document, video, etc.
  file_id VARCHAR(255), -- Для фото, документів, відео тощо
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Індекси для швидкого пошуку
CREATE INDEX IF NOT EXISTS idx_closer_reports_closer ON closer_reports(closer_chat_id);
CREATE INDEX IF NOT EXISTS idx_closer_reports_created_at ON closer_reports(created_at DESC);

-- Тригер для автоматичного оновлення updated_at
CREATE OR REPLACE FUNCTION update_closer_reports_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_closer_reports_updated_at ON closer_reports;
CREATE TRIGGER trigger_update_closer_reports_updated_at
BEFORE UPDATE ON closer_reports
FOR EACH ROW
EXECUTE FUNCTION update_closer_reports_updated_at();

-- Коментарі для документації
COMMENT ON TABLE closer_reports IS 'Звіти клоузерів (з фото та текстом)';
COMMENT ON COLUMN closer_reports.closer_chat_id IS 'Chat ID клоузера, який надіслав звіт';
COMMENT ON COLUMN closer_reports.message_text IS 'Текст звіту';
COMMENT ON COLUMN closer_reports.message_type IS 'Тип повідомлення: text, photo, document, video, etc.';
COMMENT ON COLUMN closer_reports.file_id IS 'ID файлу в Telegram (для фото, документів, відео)';
