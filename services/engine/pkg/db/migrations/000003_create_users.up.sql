CREATE TABLE users (
    id                         bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name                       text        NOT NULL,
    email                      text        NOT NULL,
    password_hash              text        NOT NULL,
    role                       text        NOT NULL REFERENCES roles (name),
    active                     boolean     NOT NULL DEFAULT true,
    daily_video_limit_override integer     CHECK (daily_video_limit_override >= -1),
    created_at                 timestamptz NOT NULL DEFAULT now(),
    updated_at                 timestamptz NOT NULL DEFAULT now()
);

-- El correo es único sin distinguir mayúsculas ("Ana@x.com" y "ana@x.com" son la misma cuenta).
CREATE UNIQUE INDEX users_email_lower_key ON users (lower(email));

-- Índice de la clave foránea hacia roles (evita scans al filtrar/joinear por rol).
CREATE INDEX users_role_idx ON users (role);
