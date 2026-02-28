-- Обмеження: максимум 10 улюблених на одного клоузера (owner_email)

CREATE OR REPLACE FUNCTION check_user_favorites_max_10()
RETURNS TRIGGER AS $$
DECLARE
  fav_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO fav_count
  FROM user_favorites
  WHERE owner_email = NEW.owner_email;

  IF fav_count >= 10 THEN
    RAISE EXCEPTION 'У клоузера не може бути більше 10 улюблених (максимум 10)';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_user_favorites_max_10 ON user_favorites;
CREATE TRIGGER trigger_user_favorites_max_10
  BEFORE INSERT ON user_favorites
  FOR EACH ROW
  EXECUTE FUNCTION check_user_favorites_max_10();

COMMENT ON FUNCTION check_user_favorites_max_10() IS 'Обмежує кількість улюблених на одного клоузера до 10';
