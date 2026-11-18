const db = require('../config/db');

async function parametros() {
  const [filas] = await db.query('SELECT * FROM parametros_cultivo LIMIT 1');
  return filas[0];
}

async function sensores() {
  const [filas] = await db.query('SELECT id_sensor, nombre, ubicacion, tipo_conexion, estado FROM sensores ORDER BY id_sensor');
  return filas;
}

// Última lectura de cada sensor
async function ultimasLecturas() {
  const [filas] = await db.query(
    `SELECT s.id_sensor, s.nombre, r.humedad, r.temperatura,
            DATE_FORMAT(r.fecha_hora, '%d/%m/%Y %H:%i:%s') AS fecha_hora
       FROM sensores s
       JOIN registros r ON r.id_registro = (
              SELECT id_registro FROM registros WHERE id_sensor = s.id_sensor
               ORDER BY id_registro DESC LIMIT 1)
      ORDER BY s.id_sensor`
  );
  return filas;
}

// Historial general reciente (últimos 7 días)
async function historial(limite = 60) {
  const [filas] = await db.query(
    `SELECT id_registro, sensor, ubicacion, humedad, temperatura, estado,
            DATE_FORMAT(fecha_hora, '%d/%m/%Y %H:%i') AS fecha_hora,
            DATE_FORMAT(fecha_hora, '%Y-%m-%d') AS fecha_iso
       FROM v_historial
      WHERE fecha_hora >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
      ORDER BY v_historial.fecha_hora DESC, id_registro DESC
      LIMIT ?`,
    [limite]
  );
  return filas;
}

// Resumen semanal agrupado por día (últimos 7 días) para las dos versiones: Temperatura y Humedad
async function historialSemanal() {
  const [filas] = await db.query(
    `SELECT DATE_FORMAT(r.fecha_hora, '%Y-%m-%d') AS fecha,
            DATE_FORMAT(r.fecha_hora, '%d/%m') AS dia_corto,
            ROUND(AVG(r.temperatura), 1) AS temp_promedio,
            ROUND(MIN(r.temperatura), 1) AS temp_min,
            ROUND(MAX(r.temperatura), 1) AS temp_max,
            ROUND(AVG(r.humedad), 1) AS hum_promedio,
            ROUND(MIN(r.humedad), 1) AS hum_min,
            ROUND(MAX(r.humedad), 1) AS hum_max,
            COUNT(*) AS lecturas
       FROM registros r
      WHERE r.fecha_hora >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
      GROUP BY DATE_FORMAT(r.fecha_hora, '%Y-%m-%d'), DATE_FORMAT(r.fecha_hora, '%d/%m')
      ORDER BY fecha ASC`
  );
  return filas;
}

// Inserta una nueva lectura (usado por el botón de riego manual gradual)
async function registrarLectura({ id_sensor, humedad, temperatura }) {
  const [res] = await db.query(
    `INSERT INTO registros (id_sensor, humedad, temperatura, fecha_hora)
     VALUES (?, ?, ?, NOW())`,
    [id_sensor, humedad, temperatura]
  );
  return res.insertId;
}

module.exports = {
  parametros,
  sensores,
  ultimasLecturas,
  historial,
  historialSemanal,
  registrarLectura
};
