-- Міграція для створення таблиці звітів воркерів
-- Таблиця для зберігання звітів, які воркери надсилають клоузерам

CREATE TABLE IF NOT EXISTS worker_reports (
  id BIGSERIAL PRIMARY KEY,
  worker_chat_id BIGINT NOT NULL,
  closer_chat_id BIGINT NOT NULL,
  message_text TEXT NOT NULL,
  message_type VARCHAR(50) DEFAULT 'text', -- text, photo, document, video, etc.
  file_id VARCHAR(255), -- Для фото, документів, відео тощо
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at TIMESTAMPTZ, -- Коли клоузер прочитав звіт
  status VARCHAR(20) NOT NULL DEFAULT 'unread' CHECK (status IN ('unread', 'read'))
);

-- Індекси для швидкого пошуку
CREATE INDEX IF NOT EXISTS idx_worker_reports_worker ON worker_reports(worker_chat_id);
CREATE INDEX IF NOT EXISTS idx_worker_reports_closer ON worker_reports(closer_chat_id);
CREATE INDEX IF NOT EXISTS idx_worker_reports_created_at ON worker_reports(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_worker_reports_status ON worker_reports(status);
CREATE INDEX IF NOT EXISTS idx_worker_reports_closer_unread ON worker_reports(closer_chat_id, status) WHERE status = 'unread';

-- Коментарі для документації
COMMENT ON TABLE worker_reports IS 'Звіти воркерів, які надсилаються клоузерам';
COMMENT ON COLUMN worker_reports.worker_chat_id IS 'Chat ID воркера, який надіслав звіт';
COMMENT ON COLUMN worker_reports.closer_chat_id IS 'Chat ID клоузера, якому надіслано звіт';
COMMENT ON COLUMN worker_reports.message_text IS 'Текст звіту';
COMMENT ON COLUMN worker_reports.message_type IS 'Тип повідомлення: text, photo, document, video, etc.';
COMMENT ON COLUMN worker_reports.file_id IS 'ID файлу в Telegram (для фото, документів, відео)';
COMMENT ON COLUMN worker_reports.status IS 'Статус: unread (непрочитаний), read (прочитаний)';
