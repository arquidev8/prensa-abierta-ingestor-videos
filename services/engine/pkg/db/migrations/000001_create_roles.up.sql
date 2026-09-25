-- Roles del panel. El límite diario de videos por rol vive acá (-1 = sin límite) para poder
-- ajustarlo con un UPDATE sin redeployar el Engine; cada usuario puede pisarlo con su propio
-- override (users.daily_video_limit_override).
CREATE TABLE roles (
    name              text    PRIMARY KEY,
    daily_video_limit integer NOT NULL CHECK (daily_video_limit >= -1)
);
