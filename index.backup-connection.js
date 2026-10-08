import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason
} from '@whiskeysockets/baileys'
import pino from 'pino'
import qrcode from 'qrcode-terminal'
import 'dotenv/config'
import Groq from 'groq-sdk'
import fs from 'fs'

const OWNER_NUMBER = process.env.OWNER_NUMBER?.replace(/\D/g, '')
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })

const CONFIG_FILE = './data/config.json'
const MEMORY_FILE = './data/memoria.json'

function cargarConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))
}

function cargarMemoria() {
  return JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8'))
}

function guardarMemoria(memoria) {
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(memoria, null, 2))
}

function esDueño(jid) {
  return jid?.split('@')[0] === OWNER_NUMBER
}

async function preguntarIA(texto) {
  const config = cargarConfig()
  const memoria = cargarMemoria()

  const recuerdos = memoria.global.length
    ? `\nMemorias autorizadas por el dueño:\n- ${memoria.global.join('\n- ')}`
    : ''

  const respuesta = await groq.chat.completions.create({
    model: 'openai/gpt-oss-20b',
    messages: [
      {
        role: 'system',
        content: `${config.personalidad}
Tu nombre es ${config.nombre || 'AI'}.
Nunca digas que aprendiste algo de conversaciones privadas si no fue guardado explícitamente como memoria.
No inventes recuerdos.${recuerdos}`
      },
      {
        role: 'user',
        content: texto
      }
    ],
    temperature: 0.7,
    max_tokens: 500
  })

  return respuesta.choices[0]?.message?.content?.trim()
    || 'No pude generar una respuesta.'
}

async function iniciarBot() {
  const { state, saveCreds } = await useMultiFileAuthState('./session')

  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false
  })

  sock.ev.on('creds.update', saveCreds)

  if (!sock.authState?.creds?.registered) {
    const codigo = await sock.requestPairingCode(OWNER_NUMBER)
    console.log('\n================================')
    console.log('   CÓDIGO DE VINCULACIÓN')
    console.log('================================')
    console.log(codigo)
    console.log('================================\n')
  }

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) qrcode.generate(qr, { small: true })

    if (connection === 'open') {
      console.log('LEVI BOT AI ONLINE')
      console.log('IA privada: SOLO DUEÑO')
      console.log('IA en grupos: SOLO GRUPOS AUTORIZADOS')
    }

    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode

      if (code !== DisconnectReason.loggedOut) {
        console.log('Conexión cerrada. Reconectando...')
        iniciarBot()
      } else {
        console.log('Sesión cerrada. Hay que vincular nuevamente.')
      }
    }
  })

  sock.ev.on('messages.upsert', async ({ messages }) => {
    try {
      const msg = messages?.[0]

      if (!msg?.message || msg.key.fromMe) return

      const jid = msg.key.remoteJid
      if (!jid) return

      const texto =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        ''

      if (!texto.trim()) return

      const config = cargarConfig()
      const memoria = cargarMemoria()
      const dueño = esDueño(jid)
      const grupo = jid.endsWith('@g.us')

      const comando = texto.trim()

      // ==============================
      // CONTROLES DEL DUEÑO
      // ==============================

      if (dueño && /^IA GRUPO ON$/i.test(comando) && grupo) {
        config.grupos[jid] = true
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2))
        await sock.sendMessage(jid, {
          text: '✅ Levi Bot AI quedó activado en este grupo.'
        })
        return
      }

      if (dueño && /^IA GRUPO OFF$/i.test(comando) && grupo) {
        delete config.grupos[jid]
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2))
        await sock.sendMessage(jid, {
          text: '🔒 Levi Bot AI quedó desactivado en este grupo.'
        })
        return
      }

      if (dueño && /^IA PRIVADA ON$/i.test(comando)) {
        config.privada = true
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2))
        await sock.sendMessage(jid, {
          text: '✅ IA privada activada para el dueño.'
        })
        return
      }

      if (dueño && /^IA PRIVADA OFF$/i.test(comando)) {
        config.privada = false
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2))
        await sock.sendMessage(jid, {
          text: '🔒 IA privada desactivada.'
        })
        return
      }

      // ==============================
      // CAMBIAR NOMBRE
      // ==============================

      if (dueño && /^NOMBRE AI /i.test(comando)) {
        const nuevoNombre = comando.replace(/^NOMBRE AI /i, '').trim()

        if (nuevoNombre) {
          config.nombre = nuevoNombre
          fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2))

          await sock.sendMessage(jid, {
            text: `✅ Ahora mi nombre es ${nuevoNombre}.`
          })
        }

        return
      }

      // ==============================
      // MEMORIA EXPLÍCITA
      // ==============================

      if (dueño && /^RECUERDA QUE /i.test(comando)) {
        const recuerdo = comando.replace(/^RECUERDA QUE /i, '').trim()

        if (recuerdo) {
          memoria.global.push(recuerdo)
          guardarMemoria(memoria)

          await sock.sendMessage(jid, {
            text: '🧠 Entendido. Guardé esa información en mi memoria.'
          })
        }

        return
      }

      if (dueño && /^OLVIDA /i.test(comando)) {
        const recuerdo = comando.replace(/^OLVIDA /i, '').trim()

        const antes = memoria.global.length

        memoria.global = memoria.global.filter(
          item => item.toLowerCase() !== recuerdo.toLowerCase()
        )

        guardarMemoria(memoria)

        await sock.sendMessage(jid, {
          text: memoria.global.length < antes
            ? '🧠 He olvidado esa memoria.'
            : 'No encontré esa memoria exacta.'
        })

        return
      }

      // ==============================
      // PERMISOS DE LA IA
      // ==============================

      if (grupo) {
        // Los grupos están bloqueados por defecto.
        if (!config.grupos[jid]) return
      } else {
        // Los privados solamente los puede usar el dueño.
        if (!dueño) return
        if (!config.privada) return
      }

      console.log(`[${grupo ? 'GRUPO' : 'PRIVADO'}] ${jid}: ${texto}`)

      const respuesta = await preguntarIA(texto)

      await sock.sendMessage(jid, {
        text: `${respuesta}\n\n● AI`
      })

      console.log(`[AI] ${respuesta}`)

    } catch (error) {
      console.error('Error procesando mensaje:', error)

      try {
        await sock.sendMessage(messages?.[0]?.key?.remoteJid, {
          text: '⚠️ Ocurrió un error al procesar tu mensaje.'
        })
      } catch {}
    }
  })
}

iniciarBot()
