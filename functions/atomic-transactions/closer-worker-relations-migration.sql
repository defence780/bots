-- Міграція для створення таблиці зв'язків між клоузерами та воркерами
-- Таблиця для аналітики та відстеження реферальних зв'язків

CREATE TABLE IF NOT EXISTS closer_worker_relations (
  id BIGSERIAL PRIMARY KEY,
  closer_chat_id BIGINT NOT NULL,
  worker_chat_id BIGINT NOT NULL,
  bound_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  unbound_at TIMESTAMPTZ,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Індекси для швидкого пошуку
CREATE INDEX IF NOT EXISTS idx_closer_worker_closer ON closer_worker_relations(closer_chat_id);
CREATE INDEX IF NOT EXISTS idx_closer_worker_worker ON closer_worker_relations(worker_chat_id);
CREATE INDEX IF NOT EXISTS idx_closer_worker_status ON closer_worker_relations(status);
CREATE INDEX IF NOT EXISTS idx_closer_worker_bound_at ON closer_worker_relations(bound_at DESC);
CREATE INDEX IF NOT EXISTS idx_closer_worker_active ON closer_worker_relations(closer_chat_id, status) WHERE status = 'active';

-- Унікальний індекс: один воркер може бути прив'язаний до одного клоузера одночасно (тільки для активних)
CREATE UNIQUE INDEX IF NOT EXISTS idx_closer_worker_unique_active 
ON closer_worker_relations(worker_chat_id) 
WHERE status = 'active';

-- Тригер для автоматичного оновлення updated_at
CREATE OR REPLACE FUNCTION update_closer_worker_relations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_closer_worker_relations_updated_at ON closer_worker_relations;
CREATE TRIGGER trigger_update_closer_worker_relations_updated_at
BEFORE UPDATE ON closer_worker_relations
FOR EACH ROW
EXECUTE FUNCTION update_closer_worker_relations_updated_at();

-- Коментарі для документації
COMMENT ON TABLE closer_worker_relations IS 'Зв\'язки між клоузерами та воркерами для аналітики';
COMMENT ON COLUMN closer_worker_relations.closer_chat_id IS 'Chat ID клоузера';
COMMENT ON COLUMN closer_worker_relations.worker_chat_id IS 'Chat ID воркера';
COMMENT ON COLUMN closer_worker_relations.bound_at IS 'Час прив\'язки воркера до клоузера';
COMMENT ON COLUMN closer_worker_relations.unbound_at IS 'Час відв\'язки воркера від клоузера';
COMMENT ON COLUMN closer_worker_relations.status IS 'Статус зв\'язку: active (активний), inactive (неактивний)';
