// Interfaz del Monitor de Orquídeas: calendario de riego, notificaciones, condiciones, historial semanal y reportes.
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const CANAL_TXT = { correo: 'Correo', whatsapp: 'WhatsApp', ambos: 'Correo y WhatsApp' };

const $ = (sel) => document.querySelector(sel);
const estado = {
  hoy: null,
  mes: null,
  seleccionado: null,
  riegos: [],
  versionHistorial: 'humedad', // 'humedad' | 'temperatura'
  datosCondiciones: null,
  riegoActivo: null
};

// Crea elementos sin usar innerHTML (los textos nunca se interpretan como HTML)
function h(tag, props = {}, ...hijos) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of hijos.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

async function api(ruta, { method = 'GET', body, signal } = {}) {
  const res = await fetch('/api' + ruta, {
    method,
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store', // <--- Obliga a pedir los datos frescos al servidor
    signal,            // <--- Permite cancelar la petición si se detiene el riego
    body: body ? JSON.stringify(body) : undefined
  });
  const datos = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(datos.error || 'Ocurrió un error inesperado.');
  return datos;
}

function mensaje(selector, texto, tipo) {
  const el = $(selector);
  el.className = 'msg' + (tipo ? ' ' + tipo : '');
  el.replaceChildren(...(Array.isArray(texto) ? texto : [texto]));
}

// ---------- Fechas ----------
const pad = (n) => String(n).padStart(2, '0');
const fechaTexto = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
const diaSemana = (f) => { const [y, m, d] = f.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
const fechaLegible = (f) => { const [y, m, d] = f.split('-'); return `${DIAS[diaSemana(f)]} ${Number(d)} de ${MESES[Number(m) - 1]} de ${y}`; };
const fechaCorta = (f) => { const [y, m, d] = f.split('-'); return `${d}/${m}/${y}`; };

function riegosDelDia(fecha) {
  return estado.riegos.filter((r) =>
    r.fecha === fecha || (r.repetir_semanal && r.fecha <= fecha && diaSemana(r.fecha) === diaSemana(fecha)));
}

// ---------- Pestañas ----------
document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  document.querySelectorAll('.tabs button').forEach((t) => t.classList.remove('active'));
  $('#' + b.dataset.vista).classList.add('active');
  b.classList.add('active');
  if (b.dataset.vista === 'notificaciones') cargarNotificaciones();
  if (b.dataset.vista === 'condiciones') {
    cargarCondiciones();
    actualizarMonitoreoExterno();
  }
}));

// ---------- Estado general y calendario ----------
async function cargarEstado() {
  const e = await api('/estado');
  estado.hoy = e.ahora.fecha;
  if (!estado.mes) estado.mes = { y: Number(e.ahora.fecha.slice(0, 4)), m: Number(e.ahora.fecha.slice(5, 7)) - 1 };
  $('#banner-prueba').hidden = !e.modoPrueba;
  $('#reloj').textContent = `${fechaCorta(e.ahora.fecha)} · ${e.ahora.hora.slice(0, 5)} (${e.zonaHoraria})`;
  $('#proximo').textContent = e.proximoRiego
    ? `${fechaLegible(e.proximoRiego.fecha)} · ${e.proximoRiego.hora}${e.proximoRiego.nota ? ' — ' + e.proximoRiego.nota : ''}`
    : 'Sin riegos programados';
}

async function cargarRiegos() {
  estado.riegos = await api('/riegos');
  dibujarCalendario();
  dibujarTablaRiegos();
}

function dibujarCalendario() {
  const { y, m } = estado.mes;
  $('#mes-titulo').textContent = `${MESES[m]} ${y}`;
  const primero = (new Date(Date.UTC(y, m, 1)).getUTCDay() + 6) % 7;   // semana desde lunes
  const total = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const celdas = [];
  for (let i = 0; i < primero; i++) celdas.push(h('span', { class: 'dia dia-vacio' }));
  for (let d = 1; d <= total; d++) {
    const f = fechaTexto(y, m, d);
    const hay = riegosDelDia(f).length > 0;
    const clases = ['dia'];
    if (f === estado.hoy) clases.push('hoy');
    if (f === estado.seleccionado) clases.push('sel');
    if (hay) clases.push('con-riego');
    celdas.push(h('button', {
      class: clases.join(' '), type: 'button', disabled: f < estado.hoy,
      'aria-label': fechaLegible(f), onclick: () => elegirDia(f)
    }, String(d), hay ? h('span', { class: 'punto' }, '💧') : null));
  }
  $('#cal-celdas').replaceChildren(...celdas);
}

function elegirDia(f) {
  estado.seleccionado = f;
  $('#form-vacio').hidden = true;
  $('#form-riego').hidden = false;
  $('#dia-elegido').textContent = fechaLegible(f);
  mensaje('#msg-riego', '');
  dibujarCalendario();
}

$('#mes-ant').addEventListener('click', () => { cambiarMes(-1); });
$('#mes-sig').addEventListener('click', () => { cambiarMes(1); });
function cambiarMes(delta) {
  const f = new Date(Date.UTC(estado.mes.y, estado.mes.m + delta, 1));
  estado.mes = { y: f.getUTCFullYear(), m: f.getUTCMonth() };
  dibujarCalendario();
}

$('#form-riego').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const boton = ev.target.querySelector('button[type=submit]');
  boton.disabled = true;
  try {
    await api('/riegos', {
      method: 'POST',
      body: {
        fecha: estado.seleccionado,
        hora: $('#hora').value,
        canal: $('#canal').value,
        nota: $('#nota').value,
        repetir_semanal: $('#repetir').checked
      }
    });
    mensaje('#msg-riego', `Riego guardado: te avisaremos el ${fechaLegible(estado.seleccionado)} a las ${$('#hora').value}.`, 'ok');
    $('#nota').value = '';
    $('#repetir').checked = false;
    await Promise.all([cargarRiegos(), cargarEstado()]);
  } catch (err) {
    mensaje('#msg-riego', err.message, 'error');
  } finally {
    boton.disabled = false;
  }
});

function estadoDeRiego(r) {
  if (r.repetir_semanal) return h('span', { class: 'badge info' }, 'Cada semana');
  if (r.ultima_notificacion) return h('span', { class: 'badge ok' }, 'Avisado');
  return h('span', { class: 'badge warn' }, 'Pendiente');
}

function dibujarTablaRiegos() {
  $('#riegos-vacio').hidden = estado.riegos.length > 0;
  $('#tabla-riegos').replaceChildren(...estado.riegos.map((r) => h('tr', {},
    h('td', {}, fechaLegible(r.fecha), r.repetir_semanal ? h('br') : null,
      r.repetir_semanal ? h('small', {}, `se repite los ${DIAS[diaSemana(r.fecha)]}`) : null),
    h('td', {}, r.hora),
    h('td', {}, CANAL_TXT[r.canal]),
    h('td', {}, r.nota || '—'),
    h('td', {}, estadoDeRiego(r)),
    h('td', { class: 'acciones' },
      h('button', { class: 'btn chico sec', type: 'button', onclick: (e) => probarRiego(r, e.target) }, 'Probar ahora'),
      h('button', { class: 'btn chico peligro', type: 'button', onclick: () => eliminarRiego(r) }, 'Eliminar')))));
}

async function probarRiego(r, boton) {
  boton.disabled = true;
  try {
    const { resultados } = await api(`/riegos/${r.id_riego}/probar`, { method: 'POST' });
    mensaje('#msg-riego', resumenEnvio(resultados), resultados.some((x) => x.estado === 'Error') ? 'error' : 'ok');
  } catch (err) {
    mensaje('#msg-riego', err.message, 'error');
  } finally {
    boton.disabled = false;
  }
}

async function eliminarRiego(r) {
  if (!confirm(`¿Eliminar el riego del ${fechaCorta(r.fecha)} a las ${r.hora}?`)) return;
  try {
    await api(`/riegos/${r.id_riego}`, { method: 'DELETE' });
    await Promise.all([cargarRiegos(), cargarEstado()]);
  } catch (err) {
    mensaje('#msg-riego', err.message, 'error');
  }
}

function resumenEnvio(resultados) {
  return [h('span', {}, 'Resultado del envío:'),
    h('ul', {}, resultados.map((x) =>
      h('li', {}, `${CANAL_TXT[x.canal]} → ${x.estado}${x.destino ? ' (' + x.destino + ')' : ''}. ${x.detalle || ''}`)))];
}

// ---------- Notificaciones ----------
async function cargarContacto() {
  const c = await api('/contacto');
  $('#correo').value = c.correo || '';
  $('#whatsapp').value = c.whatsapp || '';
}

$('#form-contacto').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  try {
    await api('/contacto', { method: 'PUT', body: { correo: $('#correo').value, whatsapp: $('#whatsapp').value } });
    mensaje('#msg-contacto', 'Contacto guardado.', 'ok');
  } catch (err) {
    mensaje('#msg-contacto', err.message, 'error');
  }
});

$('#btn-prueba').addEventListener('click', async (ev) => {
  ev.target.disabled = true;
  try {
    const { resultados } = await api('/notificaciones/prueba', { method: 'POST', body: { canal: $('#canal-prueba').value } });
    mensaje('#msg-prueba', resumenEnvio(resultados), resultados.some((x) => x.estado === 'Error') ? 'error' : 'ok');
    await cargarNotificaciones();
  } catch (err) {
    mensaje('#msg-prueba', err.message, 'error');
  } finally {
    ev.target.disabled = false;
  }
});

async function cargarNotificaciones() {
  const lista = await api('/notificaciones');
  $('#notif-vacio').hidden = lista.length > 0;
  const clase = { Enviada: 'ok', Simulada: 'info', Error: 'off' };
  $('#tabla-notificaciones').replaceChildren(...lista.map((n) => h('tr', {},
    h('td', {}, n.fecha_hora),
    h('td', {}, n.tipo),
    h('td', {}, CANAL_TXT[n.canal]),
    h('td', {}, n.destino || '—'),
    h('td', {}, h('span', { class: 'badge ' + clase[n.estado] }, n.estado)),
    h('td', {}, h('small', {}, n.detalle || '')))));
}

// ---------- Condiciones e Historial Semanal (2 versiones: Humedad y Temperatura) ----------
async function cargarCondiciones(destacarTarjetas = false) {
  const datos = await api('/condiciones');
  estado.datosCondiciones = datos;
  console.log("¡Oye, me estoy ejecutando! Datos que llegaron:", datos.ultimas); // <-- AGREGA ESTA LÍNEA
  dibujarVistaCondiciones(destacarTarjetas);
}

function dibujarVistaCondiciones(destacarTarjetas = false) {
  if (!estado.datosCondiciones) return;
  const { parametros, ultimas, historial, semanal = [] } = estado.datosCondiciones;
  const esHum = estado.versionHistorial === 'humedad';

  const humOk = (v) => v >= Number(parametros.humedad_min) && v <= Number(parametros.humedad_max);
  const tempOk = (v) => v >= Number(parametros.temp_min) && v <= Number(parametros.temp_max);

  // 1. Tarjetas de sensores locales
  $('#stats-condiciones').replaceChildren(...ultimas.map((u) => h('div', {
    class: 'stat' + (destacarTarjetas ? ' regando-flash' : '')
  },
    h('span', {}, u.nombre),
    h('strong', {}, `${Number(u.humedad).toFixed(1)} % · ${Number(u.temperatura).toFixed(1)} °C`),
    h('small', {}, `${humOk(Number(u.humedad)) && tempOk(Number(u.temperatura)) ? '✅ Óptimo' : '⚠️ Fuera de rango'} · ${u.fecha_hora}`))));

  // 2. Gráfico y tabla de evolución semanal según la versión activa (Humedad vs Temperatura)
  $('#ver-humedad').classList.toggle('active', esHum);
  $('#ver-temperatura').classList.toggle('active', !esHum);

  $('#titulo-tabla-semanal').textContent = esHum
    ? 'Resumen diario de Humedad Relativa (últimos 7 días — Ideal: 75% a 85%)'
    : 'Resumen diario de Temperatura (últimos 7 días — Ideal: 18 °C a 24 °C)';

  $('#badge-version-detalle').textContent = esHum
    ? 'Mostrando: Versión Humedad'
    : 'Mostrando: Versión Temperatura';

  // Barras semanales
  $('#grafico-semanal').replaceChildren(...semanal.map((d) => {
    const valor = esHum ? Number(d.hum_promedio) : Number(d.temp_promedio);
    const pct = esHum
      ? Math.max(10, Math.min(100, valor))
      : Math.max(10, Math.min(100, ((valor - 10) / 25) * 100));
    const unidad = esHum ? '%' : '°C';
    const rangoTxt = esHum ? `${d.hum_min}%–${d.hum_max}%` : `${d.temp_min}°–${d.temp_max}°`;

    return h('div', { class: 'bar-col' },
      h('span', { class: 'bar-val' }, `${valor.toFixed(1)} ${unidad}`),
      h('div', { class: 'bar-track' },
        h('div', { class: 'bar-fill ' + (esHum ? 'hum' : 'temp'), style: `height:${pct}%` })),
      h('span', { class: 'bar-lbl' }, d.dia_corto),
      h('span', { class: 'bar-sub' }, rangoTxt));
  }));

  // Encabezado y filas de tabla semanal
  $('#head-semanal').replaceChildren(h('tr', {},
    h('th', {}, 'Día de la semana'),
    h('th', {}, esHum ? 'Humedad Promedio' : 'Temperatura Promedio'),
    h('th', {}, esHum ? 'Mínima del día' : 'Mínima del día'),
    h('th', {}, esHum ? 'Máxima del día' : 'Máxima del día'),
    h('th', {}, 'Lecturas'),
    h('th', {}, 'Evaluación')));

  $('#tabla-semanal').replaceChildren(...semanal.map((d) => {
    const prom = esHum ? Number(d.hum_promedio) : Number(d.temp_promedio);
    const min = esHum ? Number(d.hum_min) : Number(d.temp_min);
    const max = esHum ? Number(d.hum_max) : Number(d.temp_max);
    const u = esHum ? ' %' : ' °C';
    const enRango = esHum ? humOk(prom) : tempOk(prom);

    return h('tr', {},
      h('td', {}, `${fechaLegible(d.fecha)}`),
      h('td', { class: 'col-destacada' }, `${prom.toFixed(1)}${u}`),
      h('td', {}, `${min.toFixed(1)}${u}`),
      h('td', {}, `${max.toFixed(1)}${u}`),
      h('td', {}, String(d.lecturas)),
      h('td', {}, h('span', { class: 'badge ' + (enRango ? 'ok' : 'warn') }, enRango ? 'Óptimo' : 'Fuera de rango')));
  }));

  // 3. Tabla de historial detallado (destacando la columna de la versión seleccionada)
  $('#tabla-condiciones').replaceChildren(...historial.map((r) => h('tr', {},
    h('td', {}, r.sensor),
    h('td', { class: esHum ? 'col-destacada' : '' }, `${Number(r.humedad).toFixed(1)} %`),
    h('td', { class: !esHum ? 'col-destacada' : '' }, `${Number(r.temperatura).toFixed(1)} °C`),
    h('td', {}, r.fecha_hora),
    h('td', {}, h('span', { class: 'badge ' + (r.estado === 'Óptimo' ? 'ok' : 'warn') }, r.estado)))));
}

$('#ver-humedad').addEventListener('click', () => {
  estado.versionHistorial = 'humedad';
  dibujarVistaCondiciones();
});

$('#ver-temperatura').addEventListener('click', () => {
  estado.versionHistorial = 'temperatura';
  dibujarVistaCondiciones();
});


// ============================================================
//  RIEGO GRADUAL — versión completa y corregida
// ============================================================
const TOTAL_PASOS_RIEGO = 5;
const PAUSA_ENTRE_PASOS_MS = 1200;

// Asegúrate de que `estado` exista antes. Si ya lo tienes, esta línea no hace daño.
// const estado = { riegoActivo: false, riegoAbort: null };

$('#btn-dar-agua').addEventListener('click', async () => {
  if (estado.riegoActivo) return;

  estado.riegoActivo = true;
  estado.riegoAbort = new AbortController();

  $('#btn-dar-agua').disabled = true;
  $('#btn-detener-agua').hidden = false;
  $('#btn-detener-agua').disabled = false;
  $('#progreso-riego-wrap').hidden = false;
  $('#progreso-riego-fill').style.width = '0%';

  let pasoActual = 0;
  let completado = false;
  let cancelado = false;

  try {
    while (pasoActual < TOTAL_PASOS_RIEGO && estado.riegoActivo) {
      pasoActual++;
      const porcentaje = Math.round((pasoActual / TOTAL_PASOS_RIEGO) * 100);
      $('#progreso-riego-fill').style.width = `${porcentaje}%`;
      $('#estado-riego-txt').textContent =
        `Regando invernadero (Paso ${pasoActual} de ${TOTAL_PASOS_RIEGO}): subiendo humedad (+1.4%) y bajando temperatura (-0.4 °C)...`;

      // 1) Enviar el paso al backend
      const res = await api('/condiciones/regar-paso', {
        method: 'POST',
        signal: estado.riegoAbort.signal
      });

      // 2) Refrescar la pantalla con los datos nuevos
        await cargarCondiciones();

      // (Opcional) usar la respuesta para feedback inmediato en consola
      if (res && Array.isArray(res.lecturas)) {
        console.table(res.lecturas);
      }

      if (pasoActual < TOTAL_PASOS_RIEGO && estado.riegoActivo) {
        await new Promise(r => setTimeout(r, PAUSA_ENTRE_PASOS_MS));
      }
    }

    completado = pasoActual >= TOTAL_PASOS_RIEGO;
  } catch (err) {
    if (err && (err.name === 'AbortError' || err.message === 'Aborted')) {
      cancelado = true;
    } else {
      console.error('Error durante el riego:', err);
      $('#estado-riego-txt').textContent =
        'No se pudo completar el riego. Revisa la consola.';
    }
  } finally {
    estado.riegoActivo = false;
    estado.riegoAbort = null;
    $('#btn-dar-agua').disabled = false;
    $('#btn-detener-agua').hidden = true;

    if (completado) {
      $('#estado-riego-txt').textContent =
        '✔ Riego completado. Humedad y temperatura actualizadas.';
    } else if (cancelado || pasoActual > 0) {
      $('#estado-riego-txt').textContent =
        `Riego detenido en el paso ${pasoActual} de ${TOTAL_PASOS_RIEGO}.`;
    }

    setTimeout(() => {
      $('#progreso-riego-wrap').hidden = true;
      $('#progreso-riego-fill').style.width = '0%';
    }, 2500);
  }
});

$('#btn-detener-agua').addEventListener('click', () => {
  estado.riegoActivo = false;
  if (estado.riegoAbort) estado.riegoAbort.abort();
  $('#btn-detener-agua').disabled = true;
  $('#estado-riego-txt').textContent = 'Deteniendo riego...';
});

// ------------------------------------------------------------
// Función de refresco (la clave del arreglo)
// ------------------------------------------------------------
async function refrescarCondiciones() {
  const data = await api('/condiciones');

  // Si ya tienes una función de render, úsala:
  if (typeof window.renderCondiciones === 'function') {
    window.renderCondiciones(data);
    return;
  }
  // Si tu función de carga se llama distinto, ajusta el nombre:
  if (typeof window.cargarCondiciones === 'function') {
    await window.cargarCondiciones();
    return;
  }

  // Fallback mínimo: actualizar SOLO las tarjetas si tienes data-attributes conocidos.
  // (Borra este bloque si ya tienes render propio.)
  document.querySelectorAll('[data-sensor-id]').forEach(card => {
    const id = Number(card.getAttribute('data-sensor-id'));
    const u = (data.ultimas || []).find(x => Number(x.id_sensor) === id);
    if (!u) return;
    const h = card.querySelector('[data-campo="humedad"]');
    const t = card.querySelector('[data-campo="temperatura"]');
    if (h) h.textContent = `${u.humedad} %`;
    if (t) t.textContent = `${u.temperatura} °C`;
  });
}

// ---------- Exportación de Reportes Externos (Excel, Word y PDF) guardables en el PC ----------
function construirHTMLReporte() {
  const { semanal = [], historial = [], ultimas = [] } = estado.datosCondiciones || {};
  const fechaGen = new Date().toLocaleString('es-CL');

  const filasUltimas = ultimas.map((u) =>
    `<tr><td>${u.nombre}</td><td>${Number(u.humedad).toFixed(1)} %</td><td>${Number(u.temperatura).toFixed(1)} °C</td><td>${u.fecha_hora}</td></tr>`
  ).join('');

  const filasSemanalHum = semanal.map((d) =>
    `<tr><td>${d.fecha} (${d.dia_corto})</td><td><b>${Number(d.hum_promedio).toFixed(1)} %</b></td><td>${Number(d.hum_min).toFixed(1)} %</td><td>${Number(d.hum_max).toFixed(1)} %</td><td>${d.lecturas}</td></tr>`
  ).join('');

  const filasSemanalTemp = semanal.map((d) =>
    `<tr><td>${d.fecha} (${d.dia_corto})</td><td><b>${Number(d.temp_promedio).toFixed(1)} °C</b></td><td>${Number(d.temp_min).toFixed(1)} °C</td><td>${Number(d.temp_max).toFixed(1)} °C</td><td>${d.lecturas}</td></tr>`
  ).join('');

  const filasDetalle = historial.map((r) =>
    `<tr><td>${r.sensor}</td><td>${Number(r.humedad).toFixed(1)} %</td><td>${Number(r.temperatura).toFixed(1)} °C</td><td>${r.fecha_hora}</td><td>${r.estado}</td></tr>`
  ).join('');

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Reporte Monitor de Orquídeas</title>
<style>
  body { font-family: Calibri, Arial, sans-serif; color: #222; margin: 24px; }
  h1 { color: #7e3a8a; margin-bottom: 4px; }
  h2 { color: #4a3a52; margin-top: 24px; border-bottom: 2px solid #7e3a8a; padding-bottom: 4px; }
  p.meta { color: #555; font-size: 13px; margin-top: 0; }
  table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 13px; }
  th { background-color: #7e3a8a; color: #ffffff; text-align: left; padding: 8px; border: 1px solid #ccc; }
  td { padding: 7px 8px; border: 1px solid #ccc; }
  tr:nth-child(even) td { background-color: #f9f6fb; }
</style>
</head>
<body>
  <h1>Reporte de Condiciones Ambientales – Monitor de Orquídeas</h1>
  <p class="meta">Generado el: ${fechaGen} · Parámetros ideales: Humedad 75%–85% | Temperatura 18°C–24°C</p>

  <h2>1. Estado Actual de Sensores</h2>
  <table>
    <thead><tr><th>Sensor</th><th>Humedad Actual</th><th>Temperatura Actual</th><th>Última Lectura</th></tr></thead>
    <tbody>${filasUltimas}</tbody>
  </table>

  <h2>2. Historial Semanal – Versión 1: Humedad Relativa (Últimos 7 días)</h2>
  <table>
    <thead><tr><th>Fecha</th><th>Humedad Promedio</th><th>Mínima</th><th>Máxima</th><th>Total Lecturas</th></tr></thead>
    <tbody>${filasSemanalHum}</tbody>
  </table>

  <h2>3. Historial Semanal – Versión 2: Temperatura (Últimos 7 días)</h2>
  <table>
    <thead><tr><th>Fecha</th><th>Temperatura Promedio</th><th>Mínima</th><th>Máxima</th><th>Total Lecturas</th></tr></thead>
    <tbody>${filasSemanalTemp}</tbody>
  </table>

  <h2>4. Detalle de Lecturas Registradas</h2>
  <table>
    <thead><tr><th>Sensor</th><th>Humedad</th><th>Temperatura</th><th>Fecha y Hora</th><th>Evaluación</th></tr></thead>
    <tbody>${filasDetalle}</tbody>
  </table>
</body>
</html>`;
}

function descargarArchivo(contenido, nombreArchivo, mimeType) {
  const blob = new Blob(['﻿', contenido], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombreArchivo;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

$('#btn-export-excel').addEventListener('click', () => {
  if (!estado.datosCondiciones) return;
  const html = construirHTMLReporte();
  const fecha = estado.hoy || new Date().toISOString().slice(0, 10);
  descargarArchivo(html, `Reporte_Orquideas_${fecha}.xls`, 'application/vnd.ms-excel;charset=utf-8');
});

$('#btn-export-word').addEventListener('click', () => {
  if (!estado.datosCondiciones) return;
  const html = construirHTMLReporte();
  const fecha = estado.hoy || new Date().toISOString().slice(0, 10);
  descargarArchivo(html, `Reporte_Orquideas_${fecha}.doc`, 'application/msword;charset=utf-8');
});

$('#btn-export-pdf').addEventListener('click', () => {
  if (!estado.datosCondiciones) return;
  const html = construirHTMLReporte();
  const ventana = window.open('', '_blank', 'width=900,height=700');
  if (!ventana) {
    alert('Permite las ventanas emergentes para generar el PDF.');
    return;
  }
  ventana.document.open();
  ventana.document.write(html);
  ventana.document.close();
  ventana.focus();
  setTimeout(() => {
    ventana.print();
  }, 350);
});

// ---------- Monitoreo Externo en Tiempo Real (Open-Meteo) ----------
const API_URL = 'https://api.open-meteo.com/v1/forecast?latitude=-34.2464&longitude=-71.3097&current=temperature_2m,relative_humidity_2m';

async function actualizarMonitoreoExterno() {
  const tempEl = $('#orchid-temp');
  const humEl = $('#orchid-humidity');
  const statusEl = $('#api-status');
  const timerEl = $('#api-timer');

  if (!tempEl || !humEl) return;

  try {
    statusEl.textContent = 'Actualizando...';
    statusEl.className = 'badge warn';

    const res = await fetch(API_URL);
    if (!res.ok) throw new Error('Respuesta no válida del servidor externo');

    const data = await res.json();
    tempEl.textContent = `${Number(data.current.temperature_2m).toFixed(1)} °C`;
    humEl.textContent = `${Number(data.current.relative_humidity_2m).toFixed(1)} %`;

    statusEl.textContent = 'En vivo';
    statusEl.className = 'badge ok';
    timerEl.textContent = new Date().toLocaleTimeString();
  } catch (err) {
    statusEl.textContent = 'Sin conexión';
    statusEl.className = 'badge off';
    console.error('Error al rescatar telemetría externa:', err);
  }
}

// ---------- Arranque y actualización automática ----------
async function iniciar() {
  try {
    await cargarEstado();
    await Promise.all([cargarRiegos(), cargarContacto()]);
    actualizarMonitoreoExterno();
  } catch (err) {
    mensaje('#msg-riego', 'No se pudo conectar con el servidor: ' + err.message, 'error');
  }
}
iniciar();

// Intervalo general de la aplicación
setInterval(async () => {
  try {
    await Promise.all([cargarEstado(), cargarRiegos()]);
    if ($('#notificaciones').classList.contains('active')) await cargarNotificaciones();
    if ($('#condiciones').classList.contains('active') && !estado.riegoActivo) await cargarCondiciones();
  } catch (_) { /* si el servidor no responde, se reintenta en el próximo ciclo */ }
}, 15000);

// Intervalo de actualización del monitoreo externo (cada 10 segundos)
setInterval(actualizarMonitoreoExterno, 10000);
