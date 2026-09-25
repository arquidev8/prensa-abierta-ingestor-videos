-- Contador de renders por usuario y día. La fecha la calcula la aplicación en la zona horaria
-- configurada (USAGE_TIMEZONE), así que el contador se reinicia solo al cambiar de día.
-- La clave primaria (user_id, usage_date) cubre también el índice de la clave foránea.
CREATE TABLE video_usage (
    user_id    bigint  NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    usage_date date    NOT NULL,
    count      integer NOT NULL DEFAULT 0 CHECK (count >= 0),
    PRIMARY KEY (user_id, usage_date)
);
