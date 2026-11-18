-- Monitoreo de cultivo de orquídeas (MySQL / MariaDB)
-- Se puede ejecutar con:  npm run db:init   o importar en Workbench / phpMyAdmin.

CREATE DATABASE IF NOT EXISTS orquideas_monitor
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE orquideas_monitor;

-- ---------------------------------------------------------------
-- Parámetros ideales del cultivo (humedad ~80 %, temperatura 18–24 °C)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS parametros_cultivo (
  id_parametro            INT AUTO_INCREMENT PRIMARY KEY,
  humedad_ideal           DECIMAL(5,2) NOT NULL DEFAULT 80.00,
  humedad_min             DECIMAL(5,2) NOT NULL DEFAULT 75.00,
  humedad_max             DECIMAL(5,2) NOT NULL DEFAULT 85.00,
  temp_min                DECIMAL(5,2) NOT NULL DEFAULT 18.00,
  temp_max                DECIMAL(5,2) NOT NULL DEFAULT 24.00,
  frecuencia_registro_min INT          NOT NULL DEFAULT 60   -- cada cuántos minutos se guarda un registro
);

-- ---------------------------------------------------------------
-- Sensores conectados por Bluetooth o Wi-Fi
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sensores (
  id_sensor      INT AUTO_INCREMENT PRIMARY KEY,
  nombre         VARCHAR(60)  NOT NULL,
  ubicacion      VARCHAR(100) NOT NULL,
  tipo_conexion  ENUM('Bluetooth','Wi-Fi') NOT NULL,
  identificador  VARCHAR(60)  NOT NULL,                      -- MAC o IP
  estado         ENUM('Conectado','Desconectado') NOT NULL DEFAULT 'Desconectado'
);

-- ---------------------------------------------------------------
-- Historial de condiciones ambientales
-- (El índice idx_registros_fecha va dentro de CREATE TABLE para evitar Duplicate key name al re-ejecutar)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS registros (
  id_registro  BIGINT AUTO_INCREMENT PRIMARY KEY,
  id_sensor    INT          NOT NULL,
  humedad      DECIMAL(5,2) NOT NULL,                        -- % HR
  temperatura  DECIMAL(5,2) NOT NULL,                        -- °C
  fecha_hora   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_registros_fecha (fecha_hora),
  CONSTRAINT fk_registros_sensor FOREIGN KEY (id_sensor) REFERENCES sensores(id_sensor),
  CONSTRAINT chk_humedad     CHECK (humedad BETWEEN 0 AND 100),
  CONSTRAINT chk_temperatura CHECK (temperatura BETWEEN -50 AND 100)
);

-- ---------------------------------------------------------------
-- Contacto donde llegan las notificaciones (una sola fila, id = 1)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contacto_notificaciones (
  id        TINYINT PRIMARY KEY,
  correo    VARCHAR(120) NULL,
  whatsapp  VARCHAR(20)  NULL                                -- con código de país, ej. +56912345678
);

-- ---------------------------------------------------------------
-- Calendario de riego (RF1)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS calendario_riego (
  id_riego             INT AUTO_INCREMENT PRIMARY KEY,
  fecha                DATE         NOT NULL,
  hora                 TIME         NOT NULL,
  repetir_semanal      TINYINT(1)   NOT NULL DEFAULT 0,
  canal                ENUM('correo','whatsapp','ambos') NOT NULL DEFAULT 'correo',
  nota                 VARCHAR(160) NULL,
  activo               TINYINT(1)   NOT NULL DEFAULT 1,
  ultima_notificacion  DATE         NULL,
  creado               DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------
-- Notificaciones enviadas (RF2): una fila por canal y por envío
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notificaciones (
  id_notificacion  INT AUTO_INCREMENT PRIMARY KEY,
  id_riego         INT NULL,
  tipo             ENUM('Riego','Prueba') NOT NULL DEFAULT 'Riego',
  canal            ENUM('correo','whatsapp') NOT NULL,
  destino          VARCHAR(120) NULL,
  estado           ENUM('Enviada','Simulada','Error') NOT NULL,
  mensaje          VARCHAR(500) NOT NULL,
  detalle          VARCHAR(300) NULL,
  fecha_hora       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_notif_riego FOREIGN KEY (id_riego) REFERENCES calendario_riego(id_riego) ON DELETE SET NULL
);

-- ---------------------------------------------------------------
-- Vista del historial con el estado según los parámetros ideales
-- ---------------------------------------------------------------
CREATE OR REPLACE VIEW v_historial AS
SELECT r.id_registro, s.nombre AS sensor, s.ubicacion,
       r.humedad, r.temperatura, r.fecha_hora,
       CASE
         WHEN r.humedad < p.humedad_min OR r.humedad > p.humedad_max THEN 'Humedad fuera de rango'
         WHEN r.temperatura < p.temp_min OR r.temperatura > p.temp_max THEN 'Temperatura fuera de rango'
         ELSE 'Óptimo'
       END AS estado
FROM registros r
JOIN sensores s ON s.id_sensor = r.id_sensor
CROSS JOIN parametros_cultivo p;

-- ---------------------------------------------------------------
-- Datos iniciales
-- ---------------------------------------------------------------
INSERT INTO parametros_cultivo (humedad_ideal)
SELECT 80.00 WHERE NOT EXISTS (SELECT 1 FROM parametros_cultivo);

INSERT INTO contacto_notificaciones (id, correo, whatsapp)
SELECT 1, NULL, NULL WHERE NOT EXISTS (SELECT 1 FROM contacto_notificaciones);

INSERT INTO sensores (nombre, ubicacion, tipo_conexion, identificador, estado)
SELECT * FROM (
  SELECT 'Sensor A', 'Invernadero – sector norte', 'Wi-Fi', '192.168.1.45', 'Conectado'
  UNION ALL SELECT 'Sensor B', 'Invernadero – sector sur', 'Bluetooth', 'A4:C1:38:5F:22:9B', 'Conectado'
  UNION ALL SELECT 'Sensor C', 'Vivero – mesón 2', 'Wi-Fi', '192.168.1.52', 'Desconectado'
) AS nuevos
WHERE NOT EXISTS (SELECT 1 FROM sensores);

-- ---------------------------------------------------------------
-- Datos históricos de los últimos 7 días (para vistas semanales de Temperatura y Humedad)
-- ---------------------------------------------------------------
INSERT INTO registros (id_sensor, humedad, temperatura, fecha_hora)
SELECT * FROM (
  -- Hace 6 días
  SELECT 1 AS id_sensor, 78.5 AS humedad, 19.4 AS temperatura, TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 6 DAY), '09:00:00') AS fecha_hora
  UNION ALL SELECT 1, 74.2, 24.6, TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 6 DAY), '14:00:00')
  UNION ALL SELECT 2, 79.0, 21.8, TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 6 DAY), '14:00:00')
  UNION ALL SELECT 1, 80.1, 20.2, TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 6 DAY), '19:00:00')
  -- Hace 5 días
  UNION ALL SELECT 1, 81.2, 18.8, TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 5 DAY), '09:00:00')
  UNION ALL SELECT 1, 76.5, 23.4, TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 5 DAY), '14:00:00')
  UNION ALL SELECT 2, 80.4, 22.1, TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 5 DAY), '14:00:00')
  UNION ALL SELECT 1, 82.0, 19.9, TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 5 DAY), '19:00:00')
  -- Hace 4 días
  UNION ALL SELECT 1, 79.8, 19.1, TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 4 DAY), '09:00:00')
  UNION ALL SELECT 1, 73.0, 25.1, TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 4 DAY), '14:00:00')
  UNION ALL SELECT 2, 77.5, 23.8, TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 4 DAY), '14:00:00')
  UNION ALL SELECT 1, 80.6, 21.0, TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 4 DAY), '19:00:00')
  -- Hace 3 días
  UNION ALL SELECT 1, 82.3, 18.5, TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 3 DAY), '09:00:00')
  UNION ALL SELECT 1, 78.4, 22.7, TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 3 DAY), '14:00:00')
  UNION ALL SELECT 2, 81.1, 21.9, TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 3 DAY), '14:00:00')
  UNION ALL SELECT 1, 83.0, 19.6, TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 3 DAY), '19:00:00')
  -- Hace 2 días
  UNION ALL SELECT 1, 80.0, 19.3, TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 2 DAY), '09:00:00')
  UNION ALL SELECT 1, 75.8, 23.9, TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 2 DAY), '14:00:00')
  UNION ALL SELECT 2, 79.2, 22.5, TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 2 DAY), '14:00:00')
  UNION ALL SELECT 1, 81.5, 20.4, TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 2 DAY), '19:00:00')
  -- Ayer
  UNION ALL SELECT 1, 79.4, 18.9, TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 1 DAY), '09:00:00')
  UNION ALL SELECT 1, 71.8, 24.8, TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 1 DAY), '14:00:00')
  UNION ALL SELECT 2, 78.6, 23.0, TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 1 DAY), '14:00:00')
  UNION ALL SELECT 1, 80.9, 20.7, TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 1 DAY), '19:00:00')
  -- Hoy
  UNION ALL SELECT 1, 81.0, 18.2, TIMESTAMP(CURDATE(), '06:00:00')
  UNION ALL SELECT 1, 80.4, 20.5, TIMESTAMP(CURDATE(), '08:00:00')
  UNION ALL SELECT 1, 79.1, 22.8, TIMESTAMP(CURDATE(), '10:00:00')
  UNION ALL SELECT 1, 72.4, 24.3, TIMESTAMP(CURDATE(), '12:00:00')
  UNION ALL SELECT 2, 80.3, 23.1, TIMESTAMP(CURDATE(), '12:00:00')
  UNION ALL SELECT 1, 74.0, 23.9, TIMESTAMP(CURDATE(), '14:00:00')
  UNION ALL SELECT 2, 78.2, 22.8, TIMESTAMP(CURDATE(), '14:00:00')
) AS nuevos
WHERE (SELECT COUNT(*) FROM registros) < 10;
