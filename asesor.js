const sesiones = new Map()

const TIEMPO_MAXIMO = 20 * 60 * 1000
const TIEMPO_INACTIVIDAD = 10 * 60 * 1000

export function iniciarAsesor(jid) {
  const anterior = sesiones.get(jid)

  if (anterior?.timer) clearTimeout(anterior.timer)

  const sesion = {
    inicio: Date.now(),
    ultimoDueño: null,
    timer: null
  }

  sesion.timer = setTimeout(() => {
    const actual = sesiones.get(jid)

    if (!actual) return

    sesiones.delete(jid)

    globalThis.enviarFinAsesor?.(
      jid,
      'Lo siento mucho por la espera. En este momento nuestros asesores no han podido atenderte.\n\nLa conversación ha finalizado.'
    )
  }, TIEMPO_MAXIMO)

  sesiones.set(jid, sesion)
}

export function asesorActivo(jid) {
  return sesiones.has(jid)
}

export function registrarRespuestaDueño(jid) {
  const sesion = sesiones.get(jid)

  if (!sesion) return

  sesion.ultimoDueño = Date.now()

  if (sesion.timer) clearTimeout(sesion.timer)

  sesion.timer = setTimeout(() => {
    const actual = sesiones.get(jid)

    if (!actual) return

    sesiones.delete(jid)

    globalThis.enviarFinAsesor?.(
      jid,
      'Han pasado 10 minutos sin actividad del asesor. La atención ha finalizado.\n\nLa conversación ha finalizado.'
    )
  }, TIEMPO_INACTIVIDAD)
}

export function finalizarAsesor(jid) {
  const sesion = sesiones.get(jid)

  if (sesion?.timer) clearTimeout(sesion.timer)

  sesiones.delete(jid)
}
