-- Міграція для таблиці улюблених користувачів (closer / superadmin)
-- Дозволяє клоузерам та суперадмінам зберігати улюблених користувачів (users) для швидкого доступу

CREATE TABLE IF NOT EXISTS user_favorites (
  id BIGSERIAL PRIMARY KEY,
  owner_email VARCHAR(255) NOT NULL,
  user_chat_id BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(owner_email, user_chat_id)
);

CREATE INDEX IF NOT EXISTS idx_user_favorites_owner ON user_favorites(owner_email);
CREATE INDEX IF NOT EXISTS idx_user_favorites_user_chat_id ON user_favorites(user_chat_id);

COMMENT ON TABLE user_favorites IS 'Улюблені користувачі (users) для клоузерів та суперадмінів панелі Spotlight';
COMMENT ON COLUMN user_favorites.owner_email IS 'Email користувача spotlights_users (admin/superadmin), який додав улюбленого';
COMMENT ON COLUMN user_favorites.user_chat_id IS 'Chat ID користувача з таблиці users (Telegram), якого додано в улюблені';
