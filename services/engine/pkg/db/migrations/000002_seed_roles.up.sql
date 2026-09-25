-- Datos de referencia (separados del esquema, ver skill database-migrations).
INSERT INTO roles (name, daily_video_limit) VALUES
    ('superadmin', -1),
    ('admin',      -1),
    ('editor',      5)
ON CONFLICT (name) DO NOTHING;
