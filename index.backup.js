import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason
} from '@whiskeysockets/baileys'
import P from 'pino'
import 'dotenv/config'
import Groq from 'groq-sdk'

const OWNER_NUMBER = process.env.OWNER_NUMBER?.replace(/\D/g, '')
const AI_PRIVATE_ENABLED = process.env.AI_PRIVATE_ENABLED === 'true'

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
})

async function preguntarIA(texto) {
  const respuesta = await groq.chat.completions.create({
    model: 'openai/gpt-oss-20b',
    messages: [
      {
        role: 'system',
        content: 'Eres un asistente de WhatsApp amable, útil y claro. Responde en español.'
      },
      {
        role: 'user',
        content: texto
      }
    ],
    temperature: 0.7,
    max_tokens: 500
  })

  return respuesta.choices[0]?.message?.content?.trim() || 'No pude generar una respuesta.'
}

async function iniciarAI() {
  const { state, saveCreds } = await useMultiFileAuthState('./session')

  const sock = makeWASocket({
    auth: state,
    logger: P({ level: 'silent' })
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
    if (connection === 'open') {
      console.log('\n🤖 AI CONECTADA Y OPERATIVA\n')
    }

    if (connection === 'close') {
      const codigo = lastDisconnect?.error?.output?.statusCode

      if (codigo !== DisconnectReason.loggedOut) {
        console.log('🔄 Conexión cerrada. Reiniciando...')
        setTimeout(iniciarAI, 3000)
      } else {
        console.log('❌ Sesión cerrada. Hay que volver a vincular.')
      }
    }
  })

  if (!state.creds.registered) {
    if (!OWNER_NUMBER) {
      console.log('❌ OWNER_NUMBER no está configurado.')
      return
    }

    await new Promise(resolve => setTimeout(resolve, 3000))

    try {
      const pairingCode = await sock.requestPairingCode(OWNER_NUMBER)

      console.log('\n================================')
      console.log(`🔐 CÓDIGO: ${pairingCode}`)
      console.log('================================\n')
      console.log('WhatsApp → Dispositivos vinculados')
      console.log('→ Vincular dispositivo')
      console.log('→ Vincular con número de teléfono')
    } catch (error) {
      console.error('❌ Error al generar código:', error.message)
    }
  }

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0]

    if (!msg?.message || msg.key.fromMe) return

    const jid = msg.key.remoteJid

    // 🔒 Nunca procesar grupos por ahora.
    if (jid?.endsWith('@g.us')) return

    // 🔒 Privados solamente si el dueño los habilita.
    if (!AI_PRIVATE_ENABLED) return

    const texto =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      ''

    if (!texto.trim()) return

    try {
      console.log(`📩 Mensaje privado recibido de ${jid}`)

      const respuesta = await preguntarIA(texto)

      await sock.sendMessage(jid, {
        text: respuesta
      })

      console.log('🤖 Respuesta enviada')
    } catch (error) {
      console.error('❌ Error con Groq:', error.message)
    }
  })
}

iniciarAI()
