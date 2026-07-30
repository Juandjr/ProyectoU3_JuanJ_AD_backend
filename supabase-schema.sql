-- =====================================================
-- Script de migración: MySQL → Supabase PostgreSQL
-- Proyecto: Survival Game Backend
-- Ejecutar en: Supabase Dashboard → SQL Editor
-- =====================================================

-- Tabla de usuarios
CREATE TABLE IF NOT EXISTS public.users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(100) NOT NULL UNIQUE,
  email VARCHAR(255) NOT NULL UNIQUE,
  "passwordHash" VARCHAR(255),
  "oauthProvider" VARCHAR(20) DEFAULT 'local',
  status VARCHAR(20) DEFAULT 'inactive',
  "verificationCode" VARCHAR(10) DEFAULT NULL,
  "verificationExpiresAt" TIMESTAMP DEFAULT NULL,
  "verificationAttempts" INT DEFAULT 0,
  "recoveryToken" VARCHAR(100) DEFAULT NULL,
  "recoveryTokenExpiresAt" TIMESTAMP DEFAULT NULL,
  "mfaEnabled" BOOLEAN DEFAULT FALSE,
  "mfaSecret" VARCHAR(100) DEFAULT NULL,
  "pendingMfaSecret" VARCHAR(100) DEFAULT NULL,
  coins INT DEFAULT 0,
  "equippedCosmeticId" INT DEFAULT NULL,
  "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabla de cosméticos
CREATE TABLE IF NOT EXISTS public.cosmetics (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  price INT NOT NULL,
  "imageUrl" VARCHAR(255),
  color VARCHAR(20) DEFAULT '#7fffd4'
);

-- Tabla de resultados (scoreboard)
CREATE TABLE IF NOT EXISTS public.results (
  id SERIAL PRIMARY KEY,
  "userId" INT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  score INT NOT NULL,
  difficulty VARCHAR(20) DEFAULT 'MEDIUM',
  date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabla de cosméticos por usuario
CREATE TABLE IF NOT EXISTS public.user_cosmetics (
  "userId" INT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  "cosmeticId" INT NOT NULL REFERENCES public.cosmetics(id) ON DELETE CASCADE,
  "purchaseDate" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("userId", "cosmeticId")
);

-- Datos iniciales de cosméticos
INSERT INTO public.cosmetics (name, description, price, "imageUrl", color) 
SELECT * FROM (VALUES 
  ('Espada de Fuego', 'Una espada llameante que ilumina la oscuridad.', 500, '🔥', '#ff6b35'),
  ('Escudo de Hielo', 'Un escudo impenetrable congelado en el tiempo.', 750, '❄️', '#00d4ff'),
  ('Capa de las Sombras', 'Oculta tu presencia de los enemigos.', 1200, '🌑', '#6c3baa'),
  ('Rayo de Plasma', 'Arma de energía pura.', 2000, '⚡', '#ffe44d'),
  ('Corona Dorada', 'Símbolo de la realeza en el campo de batalla.', 5000, '👑', '#ffd700')
) AS v(name, description, price, "imageUrl", color)
WHERE NOT EXISTS (SELECT 1 FROM public.cosmetics LIMIT 1);

-- Habilitar Row Level Security (RLS) - recomendado para Supabase
-- Nota: Para el backend con clave secreta, RLS puede dejarse desactivado
-- ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.results ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.cosmetics ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.user_cosmetics ENABLE ROW LEVEL SECURITY;
